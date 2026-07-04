import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { isValidNpiFormat, lookupNpi } from "@/lib/npi";
import { distanceMiles } from "@/lib/geo";

// ============================================================
// /api/telehealth/providers — Public-safe doctor directory
// Returns only display fields for the doctor-selection screen.
// Never exposes doxy_room_url or notify_phone — those stay
// server-side until a payment is confirmed (see /confirm).
//
// If the table has zero rows for the requested state and the
// DEFAULT_PROVIDER_* env vars are fully set (including a real NPI,
// which is checked against NPPES same as the admin verify endpoint),
// auto-seeds one real, already-verified row so a fresh deploy works
// end-to-end without hand-writing SQL first. This inserts a genuine
// providers row (not a fake in-memory object), so checkout/confirm's
// foreign keys stay valid.
// ============================================================

const SELECT_FIELDS =
  "id, name, credentials, specialty, bio, photo_url, practice_name, platform_fee_cents, years_experience, lat, lng";

async function seedDefaultProvider(
  supabase: ReturnType<typeof createServerClient>,
  state: string
) {
  const name = process.env.DEFAULT_PROVIDER_NAME;
  const doxyRoomUrl = process.env.DEFAULT_DOXY_ROOM_URL;
  const notifyPhone = process.env.DEFAULT_PROVIDER_NOTIFY_PHONE;
  const npi = process.env.DEFAULT_PROVIDER_NPI;

  if (!name || !doxyRoomUrl || !notifyPhone || !npi) return null;
  if (!isValidNpiFormat(npi)) {
    console.error("[telehealth/providers] DEFAULT_PROVIDER_NPI fails format check");
    return null;
  }

  try {
    const record = await lookupNpi(npi);
    if (!record.found || !record.active || !record.licenseStates.includes(state)) {
      console.error("[telehealth/providers] DEFAULT_PROVIDER_NPI failed verification for", state);
      return null;
    }
  } catch (err) {
    console.error("[telehealth/providers] NPI verification lookup failed:", err);
    return null;
  }

  const { data, error } = await supabase
    .from("providers")
    .insert({
      name,
      license_state: state,
      npi,
      npi_verified_at: new Date().toISOString(),
      is_active: true,
      practice_name: process.env.DEFAULT_PROVIDER_PRACTICE_NAME || null,
      credentials: process.env.DEFAULT_PROVIDER_CREDENTIALS || null,
      specialty: process.env.DEFAULT_PROVIDER_SPECIALTY || null,
      doxy_room_url: doxyRoomUrl,
      notify_phone: notifyPhone,
      platform_fee_cents: Number(process.env.DEFAULT_PROVIDER_FEE_CENTS) || 10000,
      provider_payout_cents: Number(process.env.DEFAULT_PROVIDER_PAYOUT_CENTS) || 3000,
    })
    .select(SELECT_FIELDS)
    .single();

  if (error) {
    console.error("[telehealth/providers] auto-seed failed:", error);
    return null;
  }
  return data;
}

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state") || "PA";
  const latParam = req.nextUrl.searchParams.get("lat");
  const lngParam = req.nextUrl.searchParams.get("lng");
  const patientLat = latParam ? parseFloat(latParam) : null;
  const patientLng = lngParam ? parseFloat(lngParam) : null;
  const hasGeo = patientLat !== null && patientLng !== null && !isNaN(patientLat) && !isNaN(patientLng);

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("providers")
      .select(SELECT_FIELDS)
      .eq("license_state", state)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    let providers = data || [];

    if (providers.length === 0) {
      const seeded = await seedDefaultProvider(supabase, state);
      providers = seeded ? [seeded] : [];
    }

    // Sort by proximity when the patient shared their location and a
    // provider has a practice location on file. Providers without a
    // lat/lng sort last rather than being dropped.
    if (hasGeo) {
      providers = [...providers].sort((a, b) => {
        const distA =
          a.lat != null && a.lng != null
            ? distanceMiles(patientLat!, patientLng!, a.lat, a.lng)
            : Infinity;
        const distB =
          b.lat != null && b.lng != null
            ? distanceMiles(patientLat!, patientLng!, b.lat, b.lng)
            : Infinity;
        return distA - distB;
      });
    }

    return NextResponse.json({ providers });
  } catch (err) {
    console.error("[telehealth/providers] error:", err);
    return NextResponse.json({ providers: [] });
  }
}

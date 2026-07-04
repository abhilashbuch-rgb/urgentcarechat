import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ============================================================
// /api/telehealth/providers — Public-safe doctor directory
// Returns only display fields for the doctor-selection screen.
// Never exposes doxy_room_url or notify_phone — those stay
// server-side until a payment is confirmed (see /confirm).
//
// If the table has zero rows for the requested state and the
// DEFAULT_PROVIDER_* env vars are fully set, auto-seeds one real row
// so a fresh deploy works end-to-end without hand-writing SQL first.
// This inserts a genuine providers row (not a fake in-memory object),
// so checkout/confirm's foreign keys stay valid.
// ============================================================

const SELECT_FIELDS =
  "id, name, credentials, specialty, bio, photo_url, practice_name, platform_fee_cents";

async function seedDefaultProvider(
  supabase: ReturnType<typeof createServerClient>,
  state: string
) {
  const name = process.env.DEFAULT_PROVIDER_NAME;
  const doxyRoomUrl = process.env.DEFAULT_DOXY_ROOM_URL;
  const notifyPhone = process.env.DEFAULT_PROVIDER_NOTIFY_PHONE;

  if (!name || !doxyRoomUrl || !notifyPhone) return null;

  const { data, error } = await supabase
    .from("providers")
    .insert({
      name,
      license_state: state,
      practice_name: process.env.DEFAULT_PROVIDER_PRACTICE_NAME || null,
      credentials: process.env.DEFAULT_PROVIDER_CREDENTIALS || null,
      specialty: process.env.DEFAULT_PROVIDER_SPECIALTY || null,
      doxy_room_url: doxyRoomUrl,
      notify_phone: notifyPhone,
      platform_fee_cents: Number(process.env.DEFAULT_PROVIDER_FEE_CENTS) || 10000,
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

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("providers")
      .select(SELECT_FIELDS)
      .eq("license_state", state)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (data && data.length > 0) {
      return NextResponse.json({ providers: data });
    }

    const seeded = await seedDefaultProvider(supabase, state);
    return NextResponse.json({ providers: seeded ? [seeded] : [] });
  } catch (err) {
    console.error("[telehealth/providers] error:", err);
    return NextResponse.json({ providers: [] });
  }
}

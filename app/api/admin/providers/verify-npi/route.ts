import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { isValidNpiFormat, lookupNpi } from "@/lib/npi";

// ============================================================
// /api/admin/providers/verify-npi — Gate for going live.
// Looks up a provider's NPI against the real NPPES registry and, if
// it's Active and licensed in the provider's stated state, flips
// is_active=true so they start appearing in the marketplace and can
// be checked out against. Protected by ADMIN_SECRET since this
// controls who can receive live patient calls (and money).
// ============================================================

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { providerId } = await req.json();
    if (!providerId) {
      return NextResponse.json({ error: "Missing providerId" }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: provider, error } = await supabase
      .from("providers")
      .select("id, npi, license_state")
      .eq("id", providerId)
      .maybeSingle();

    if (error || !provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    if (!provider.npi || !isValidNpiFormat(provider.npi)) {
      return NextResponse.json(
        { error: "Provider has no valid-format NPI on file" },
        { status: 400 }
      );
    }

    const record = await lookupNpi(provider.npi);

    if (!record.found) {
      return NextResponse.json({ error: "NPI not found in NPPES registry" }, { status: 400 });
    }
    if (!record.active) {
      return NextResponse.json({ error: "NPI is deactivated in NPPES" }, { status: 400 });
    }
    if (!record.licenseStates.includes(provider.license_state)) {
      return NextResponse.json(
        {
          error: `NPI has no license on file for ${provider.license_state} (found: ${record.licenseStates.join(", ") || "none"})`,
        },
        { status: 400 }
      );
    }

    const { error: updateErr } = await supabase
      .from("providers")
      .update({ npi_verified_at: new Date().toISOString(), is_active: true })
      .eq("id", providerId);

    if (updateErr) {
      console.error("[admin/verify-npi] update failed:", updateErr);
      return NextResponse.json({ error: "Verification succeeded but activation failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      name: `${record.firstName} ${record.lastName}`,
      credential: record.credential,
    });
  } catch (err) {
    console.error("[admin/verify-npi] error:", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}

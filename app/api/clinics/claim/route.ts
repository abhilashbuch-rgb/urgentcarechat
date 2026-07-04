import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ============================================================
// /api/clinics/claim — A clinic owner/manager asks to claim their
// listing. Stored for manual review (see clinic_claims in schema.sql) —
// no self-serve approval yet, so nothing here writes to the public
// clinics table directly.
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const { clinicName, googlePlaceId, contactName, contactEmail, contactPhone, message } =
      await req.json();

    if (!clinicName || !contactEmail) {
      return NextResponse.json(
        { error: "Clinic name and contact email are required." },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const { error } = await supabase.from("clinic_claims").insert({
      clinic_name: clinicName,
      google_place_id: googlePlaceId || null,
      contact_name: contactName || null,
      contact_email: contactEmail,
      contact_phone: contactPhone || null,
      message: message || null,
    });

    if (error) {
      console.error("[clinics/claim] insert failed:", error);
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[clinics/claim] error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}

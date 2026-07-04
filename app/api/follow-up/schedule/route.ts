import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { toE164 } from "@/lib/phone";

// ============================================================
// /api/follow-up/schedule — Opt-in only.
// A patient checks "text me later" after viewing a clinic and gives a
// phone number. We schedule a single check-in text ~3 hours out.
// Nothing here runs without this explicit opt-in.
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const { phone, clinicName, sessionId } = await req.json();
    const e164 = toE164(String(phone || ""));

    if (!e164 || !clinicName) {
      return NextResponse.json(
        { error: "A valid phone number and clinic name are required." },
        { status: 400 }
      );
    }

    const scheduledFor = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    const supabase = createServerClient();
    const { error } = await supabase.from("follow_up_requests").insert({
      clinic_name: clinicName,
      phone: e164,
      session_id: sessionId || null,
      scheduled_for: scheduledFor,
      status: "scheduled",
    });

    if (error) {
      console.error("[follow-up/schedule] insert failed:", error);
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[follow-up/schedule] error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}

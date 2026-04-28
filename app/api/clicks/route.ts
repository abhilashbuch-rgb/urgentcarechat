import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ============================================================
// /api/clicks — Analytics endpoint
// Logs clinic interactions (directions, call) to Supabase.
// No PII — just session ID, clinic name, and action type.
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { clinicName, action, sessionId, referrerZip } = body;

    if (!clinicName || !action) {
      return NextResponse.json({ ok: true }); // Silently ignore bad data
    }

    // Try to write to Supabase; if it fails, just log and move on.
    // Analytics should never block the user experience.
    try {
      const supabase = createServerClient();
      await supabase.from("clicks").insert({
        clinic_name: clinicName,
        event_type: action,
        session_id: sessionId || null,
        referrer_zip: referrerZip || null,
      });
    } catch (dbErr) {
      // Log but don't fail — analytics are best-effort
      console.error("[clicks] Supabase write failed:", dbErr);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // Never fail on analytics
  }
}

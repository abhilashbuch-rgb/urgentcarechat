import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { pushVisitNoteToEmr } from "@/lib/metriport";

// ============================================================
// /api/telehealth/note — Post-call visit note submission.
// A one-time token (generated at checkout, texted to the provider
// once the payout webhook confirms the call happened) authorizes
// exactly one submission for that request — no provider login system
// needed. Once submitted, we attempt to push the note to the EMR via
// Metriport; on success we scrub our own copy of the note and the
// patient's name/DOB, since the medical record now lives with the
// provider's practice, not with us.
// ============================================================

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const { data: request, error } = await supabase
      .from("telehealth_requests")
      .select("patient_first_name, patient_last_name, patient_dob, symptom_summary, visit_note_submitted_at, providers(name)")
      .eq("note_token", token)
      .maybeSingle();

    if (error || !request) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    }

    if (request.visit_note_submitted_at) {
      return NextResponse.json({ error: "A note has already been submitted for this visit" }, { status: 409 });
    }

    const provider = request.providers as unknown as { name: string };

    return NextResponse.json({
      providerName: provider?.name,
      patientFirstName: request.patient_first_name,
      patientLastName: request.patient_last_name,
      patientDob: request.patient_dob,
      symptomSummary: request.symptom_summary,
    });
  } catch (err) {
    console.error("[telehealth/note] GET error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { token, note } = await req.json();
    if (!token || !note || String(note).trim().length < 5) {
      return NextResponse.json({ error: "A visit note is required" }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: request, error } = await supabase
      .from("telehealth_requests")
      .select("id, visit_note_submitted_at")
      .eq("note_token", token)
      .maybeSingle();

    if (error || !request) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    }
    if (request.visit_note_submitted_at) {
      return NextResponse.json({ error: "A note has already been submitted for this visit" }, { status: 409 });
    }

    await supabase
      .from("telehealth_requests")
      .update({
        visit_note: String(note).slice(0, 5000),
        visit_note_submitted_at: new Date().toISOString(),
        emr_push_status: "pending",
      })
      .eq("id", request.id);

    // Best-effort, synchronous push. If Metriport isn't configured or the
    // push fails, the note and patient demographics stay in our database
    // (not scrubbed) so a retry has something to send — see lib/metriport.ts.
    try {
      await pushVisitNoteToEmr(request.id);
    } catch (pushErr) {
      console.error("[telehealth/note] EMR push failed:", pushErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telehealth/note] POST error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

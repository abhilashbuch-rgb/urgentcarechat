import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { sendSms } from "@/lib/twilio";
import { PRODUCT_NAME } from "@/lib/site";

// ============================================================
// /api/cron/send-follow-ups — Called hourly by Vercel Cron (see
// vercel.json). Sends the opt-in "how did your visit go?" text for
// any follow_up_requests that are now due, then marks them sent.
// ============================================================

export async function GET(req: NextRequest) {
  // If CRON_SECRET is configured, require it — Vercel Cron sends this
  // automatically as a bearer token when the env var is set.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const supabase = createServerClient();
    const { data: due, error } = await supabase
      .from("follow_up_requests")
      .select("id, clinic_name, phone")
      .eq("status", "scheduled")
      .lte("scheduled_for", new Date().toISOString())
      .limit(20);

    if (error) throw error;

    let sent = 0;
    let failed = 0;

    for (const request of due || []) {
      try {
        await sendSms(
          request.phone,
          `Hi, this is ${PRODUCT_NAME} checking in — how did your visit to ${request.clinic_name} go? Reply STOP to opt out.`
        );
        // Mark sent FIRST and on its own — this is the guard against
        // texting someone twice, so nothing else may be bundled into it.
        await supabase
          .from("follow_up_requests")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", request.id);
        sent++;

        // Then drop the phone number, since the single message it was
        // collected for has now gone out. The row survives for reporting
        // (which clinic, when, delivered) but stops holding anything
        // identifying — which is what /privacy and /security both claim.
        // Best-effort and deliberately separate: if the nullable-column
        // migration hasn't been applied yet this fails harmlessly, and
        // must not roll back the 'sent' marker above or the patient gets
        // a second text.
        const { error: clearErr } = await supabase
          .from("follow_up_requests")
          .update({ phone: null })
          .eq("id", request.id);

        if (clearErr) {
          console.error(
            "[cron/send-follow-ups] could not clear phone (is the follow_up_requests.phone nullable migration applied?):",
            clearErr.message
          );
        }
      } catch (smsErr) {
        console.error("[cron/send-follow-ups] SMS failed:", smsErr);
        await supabase
          .from("follow_up_requests")
          .update({ status: "failed" })
          .eq("id", request.id);
        failed++;
      }
    }

    return NextResponse.json({ processed: (due || []).length, sent, failed });
  } catch (err) {
    console.error("[cron/send-follow-ups] error:", err);
    return NextResponse.json({ error: "Cron run failed" }, { status: 500 });
  }
}

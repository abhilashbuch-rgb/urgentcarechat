import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { sendSms } from "@/lib/twilio";

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
          `Hi, this is urgentcare.chat checking in — how did your visit to ${request.clinic_name} go? Reply STOP to opt out.`
        );
        await supabase
          .from("follow_up_requests")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", request.id);
        sent++;
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

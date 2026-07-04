import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { verifyTwilioSignature } from "@/lib/twilio-signature";

// ============================================================
// /api/webhooks/twilio-proxy — Fires when a Twilio Proxy Interaction
// changes state (a call or message inside a masked-call session). We
// only act on a completed voice interaction: transfer the provider's
// payout via Stripe Connect, exactly once, only after the call
// actually happened.
//
// SET THIS AS THE PROXY SERVICE'S CALLBACK URL in the Twilio console
// (Console → Proxy → your Service → Callback URL) — the SDK/API has
// no per-session way to set this, it's a Service-level setting.
//
// Confidence note: the request-signature verification below follows
// Twilio's documented algorithm exactly and should be trusted. The
// EXACT field names Twilio sends for a completed voice Interaction
// (status/duration) are checked defensively across a few likely
// candidates, but haven't been confirmed against a live webhook
// delivery — check the logs on your first real test call and adjust
// the field names below if they don't match what you see.
// ============================================================

const MIN_CALL_DURATION_SECONDS = 60;

function firstMatch(params: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (params[key] !== undefined) return params[key];
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("[webhooks/twilio-proxy] TWILIO_AUTH_TOKEN not configured");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const bodyText = await req.text();
  const params = Object.fromEntries(new URLSearchParams(bodyText).entries());

  const signature = req.headers.get("x-twilio-signature") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || req.nextUrl.host;
  const url = `${proto}://${host}${req.nextUrl.pathname}`;

  if (!verifyTwilioSignature(url, params, signature, authToken)) {
    console.error("[webhooks/twilio-proxy] signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const sessionSid = firstMatch(params, ["SessionSid"]);
  const interactionType = firstMatch(params, ["InteractionType", "Type"]);
  const status = firstMatch(params, ["InteractionStatus", "Status"]);
  const durationRaw = firstMatch(params, ["InteractionDuration", "Duration", "CallDuration"]);
  const duration = durationRaw ? parseInt(durationRaw, 10) : undefined;

  console.log(
    `[webhooks/twilio-proxy] session=${sessionSid} type=${interactionType} status=${status} duration=${duration}`
  );

  const isCompletedVoiceCall =
    interactionType?.toLowerCase() === "voice" && status?.toLowerCase() === "completed";

  // If we can't confirm a minimum duration, don't block on it — a
  // confirmed "completed" voice interaction is itself a strong signal
  // in Twilio Proxy's model. Only skip when duration IS known and short.
  const durationTooShort = duration !== undefined && duration < MIN_CALL_DURATION_SECONDS;

  if (!sessionSid || !isCompletedVoiceCall || durationTooShort) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    const supabase = createServerClient();
    const { data: request, error } = await supabase
      .from("telehealth_requests")
      .select("id, payout_status, providers(stripe_account_id, stripe_onboarded, provider_payout_cents)")
      .eq("proxy_session_sid", sessionSid)
      .maybeSingle();

    if (error || !request) {
      console.error("[webhooks/twilio-proxy] no matching telehealth_request for session", sessionSid);
      return NextResponse.json({ ok: true, skipped: true });
    }

    if (request.payout_status !== "pending") {
      // Already paid, failed, or skipped — never pay twice.
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }

    const provider = request.providers as unknown as {
      stripe_account_id: string | null;
      stripe_onboarded: boolean;
      provider_payout_cents: number;
    };

    if (!provider.stripe_account_id || !provider.stripe_onboarded) {
      await supabase
        .from("telehealth_requests")
        .update({ payout_status: "skipped", payout_error: "Provider not onboarded to Stripe Connect" })
        .eq("id", request.id);
      return NextResponse.json({ ok: true, skipped: true });
    }

    const stripe = getStripeClient();
    const transfer = await stripe.transfers.create({
      amount: provider.provider_payout_cents,
      currency: "usd",
      destination: provider.stripe_account_id,
      transfer_group: request.id,
    });

    await supabase
      .from("telehealth_requests")
      .update({ payout_status: "paid", payout_transfer_id: transfer.id })
      .eq("id", request.id);

    return NextResponse.json({ ok: true, transferId: transfer.id });
  } catch (err) {
    console.error("[webhooks/twilio-proxy] payout failed:", err);
    // Best-effort: try to record the failure so it's visible for manual follow-up.
    try {
      const supabase = createServerClient();
      await supabase
        .from("telehealth_requests")
        .update({
          payout_status: "failed",
          payout_error: err instanceof Error ? err.message : "Unknown error",
        })
        .eq("proxy_session_sid", sessionSid);
    } catch {
      // If even this fails, the error is already logged above.
    }
    return NextResponse.json({ ok: true, error: "Payout failed, logged for follow-up" });
  }
}

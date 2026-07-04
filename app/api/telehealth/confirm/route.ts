import { NextRequest, NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase";
import { sendSms, createMaskedCallSession } from "@/lib/twilio";

// ============================================================
// /api/telehealth/confirm — Poll after Stripe Checkout redirect
// Verifies payment directly with Stripe (source of truth), then
// notifies the doctor exactly once and sets up the masked call
// bridge (Twilio Proxy) so no real phone numbers are exchanged.
// Falls back to a plain Doxy-link SMS if Proxy isn't configured.
// Safe to call repeatedly (idempotent on notify).
// ============================================================

interface ProviderRow {
  name: string;
  doxy_room_url: string;
  notify_phone: string;
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return NextResponse.json({ status: "pending" });
    }

    const supabase = createServerClient();
    const { data: request, error } = await supabase
      .from("telehealth_requests")
      .select(
        "id, status, patient_phone, symptom_summary, provider_proxy_number, providers(name, doxy_room_url, notify_phone)"
      )
      .eq("stripe_session_id", sessionId)
      .maybeSingle();

    if (error || !request) {
      console.error("[telehealth/confirm] request not found:", error);
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const provider = request.providers as unknown as ProviderRow;
    let providerProxyNumber: string | null = request.provider_proxy_number;

    if (request.status !== "notified") {
      await supabase
        .from("telehealth_requests")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", request.id);

      // Try the masked call bridge first — patient and provider each get a
      // private proxy number, real numbers never shown to either side.
      const symptomLine = request.symptom_summary
        ? `Reason: "${request.symptom_summary}". `
        : "";

      try {
        if (request.patient_phone) {
          const maskedSession = await createMaskedCallSession(
            request.patient_phone,
            provider.notify_phone,
            request.id
          );
          providerProxyNumber = maskedSession.provider.proxyIdentifier;

          await supabase
            .from("telehealth_requests")
            .update({
              proxy_session_sid: maskedSession.sessionSid,
              provider_proxy_number: providerProxyNumber,
            })
            .eq("id", request.id);

          await sendSms(
            provider.notify_phone,
            `urgentcare.chat: a patient has paid and is waiting. ${symptomLine}Call them now on your private line: ${maskedSession.patient.proxyIdentifier}. Video room: ${provider.doxy_room_url}`
          );
        } else {
          throw new Error("no patient phone on file");
        }
      } catch (proxyErr) {
        console.error("[telehealth/confirm] masked call setup failed, falling back to link-only SMS:", proxyErr);
        try {
          await sendSms(
            provider.notify_phone,
            `urgentcare.chat: a patient has paid and is waiting. ${symptomLine}Join: ${provider.doxy_room_url}`
          );
        } catch (smsErr) {
          console.error("[telehealth/confirm] fallback SMS also failed:", smsErr);
        }
      }

      // Scrub the symptom text once it's been relayed — we don't retain
      // clinical content on our own servers past the moment it's needed
      // to notify the provider.
      await supabase
        .from("telehealth_requests")
        .update({ status: "notified", notified_at: new Date().toISOString(), symptom_summary: null })
        .eq("id", request.id);
    }

    return NextResponse.json({
      status: "ready",
      roomUrl: provider.doxy_room_url,
      providerName: provider.name,
      expectCallFrom: providerProxyNumber,
    });
  } catch (err) {
    console.error("[telehealth/confirm] error:", err);
    return NextResponse.json(
      { error: "Something went wrong confirming your payment." },
      { status: 500 }
    );
  }
}

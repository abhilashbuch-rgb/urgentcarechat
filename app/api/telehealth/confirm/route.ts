import { NextRequest, NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase";
import { sendSms } from "@/lib/twilio";

// ============================================================
// /api/telehealth/confirm — Poll after Stripe Checkout redirect
// Verifies payment directly with Stripe (source of truth), then
// notifies the doctor by SMS exactly once, and returns their
// room link. Safe to call repeatedly (idempotent on notify).
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
      .select("id, status, providers(name, doxy_room_url, notify_phone)")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();

    if (error || !request) {
      console.error("[telehealth/confirm] request not found:", error);
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const provider = request.providers as unknown as ProviderRow;

    if (request.status !== "notified") {
      await supabase
        .from("telehealth_requests")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", request.id);

      try {
        await sendSms(
          provider.notify_phone,
          `urgentcare.chat: a patient has paid and is waiting. Join: ${provider.doxy_room_url}`
        );
        await supabase
          .from("telehealth_requests")
          .update({ status: "notified", notified_at: new Date().toISOString() })
          .eq("id", request.id);
      } catch (smsErr) {
        // Payment already succeeded — don't fail the patient over SMS delivery.
        console.error("[telehealth/confirm] SMS notify failed:", smsErr);
      }
    }

    return NextResponse.json({
      status: "ready",
      roomUrl: provider.doxy_room_url,
      providerName: provider.name,
    });
  } catch (err) {
    console.error("[telehealth/confirm] error:", err);
    return NextResponse.json(
      { error: "Something went wrong confirming your payment." },
      { status: 500 }
    );
  }
}

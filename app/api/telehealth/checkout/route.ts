import { NextRequest, NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase";
import { toE164 } from "@/lib/phone";

// ============================================================
// /api/telehealth/checkout — Start a paid doctor-connect request
// Charges a platform/tech fee via Stripe Checkout. The medical
// visit itself is billed separately by the practice, not us.
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const { stateAttested, providerId, patientPhone, symptomSummary } = await req.json();

    if (stateAttested !== "PA") {
      return NextResponse.json(
        {
          error:
            "This service is currently only available to patients physically located in Pennsylvania.",
        },
        { status: 400 }
      );
    }

    const patientE164 = toE164(String(patientPhone || ""));
    if (!patientE164) {
      return NextResponse.json(
        { error: "A valid phone number is required so the doctor can call you." },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    let providerQuery = supabase
      .from("providers")
      .select("*")
      .eq("license_state", stateAttested)
      .eq("is_active", true);

    // If the patient picked a specific doctor from the marketplace, use that
    // one; otherwise fall back to the first active doctor for their state.
    providerQuery = providerId
      ? providerQuery.eq("id", providerId)
      : providerQuery.limit(1);

    const { data: provider, error: providerErr } = await providerQuery.maybeSingle();

    if (providerErr || !provider) {
      console.error("[telehealth/checkout] no active provider:", providerErr);
      return NextResponse.json(
        { error: "No doctor is currently available. Please try again later." },
        { status: 503 }
      );
    }

    const origin = req.nextUrl.origin;
    const stripe = getStripeClient();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: provider.platform_fee_cents,
            product_data: {
              name: `Telehealth connection fee — ${provider.name}`,
              description:
                "Technology/scheduling fee for a 30-minute chat connection. The medical visit itself is billed separately by the practice.",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/telehealth/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/telehealth`,
      metadata: { providerId: provider.id, stateAttested },
    });

    const { error: insertErr } = await supabase.from("telehealth_requests").insert({
      provider_id: provider.id,
      stripe_session_id: session.id,
      patient_state_attested: stateAttested,
      patient_phone: patientE164,
      symptom_summary: String(symptomSummary || "").slice(0, 500),
      amount_cents: provider.platform_fee_cents,
      status: "pending",
    });

    if (insertErr) {
      console.error("[telehealth/checkout] Supabase insert failed:", insertErr);
      return NextResponse.json(
        { error: "Something went wrong starting checkout. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[telehealth/checkout] error:", err);
    return NextResponse.json(
      { error: "Something went wrong starting checkout. Please try again." },
      { status: 500 }
    );
  }
}

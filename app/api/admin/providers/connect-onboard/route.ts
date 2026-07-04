import { NextRequest, NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase";

// ============================================================
// /api/admin/providers/connect-onboard — Creates (if needed) a Stripe
// Express connected account for a provider and returns a one-time
// onboarding link. Send that link to the provider so THEY enter their
// own bank details and identity info directly with Stripe — we never
// see or handle that data. Protected by ADMIN_SECRET.
//
// Prerequisite you have to do yourself: your Stripe account needs
// Connect enabled (Dashboard → Connect → get started as a platform)
// before this will work.
// ============================================================

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { providerId } = await req.json();
    if (!providerId) {
      return NextResponse.json({ error: "Missing providerId" }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: provider, error } = await supabase
      .from("providers")
      .select("id, stripe_account_id")
      .eq("id", providerId)
      .maybeSingle();

    if (error || !provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const stripe = getStripeClient();
    let accountId = provider.stripe_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        capabilities: { transfers: { requested: true } },
        business_type: "individual",
      });
      accountId = account.id;

      const { error: updateErr } = await supabase
        .from("providers")
        .update({ stripe_account_id: accountId })
        .eq("id", providerId);

      if (updateErr) {
        console.error("[admin/connect-onboard] failed to save account id:", updateErr);
      }
    }

    // refresh_url/return_url must be pages the PROVIDER's browser can load
    // without any admin auth — if the link expires mid-onboarding, the
    // admin needs to re-call this endpoint to generate a fresh one and
    // resend it; there's no self-serve provider portal yet.
    const origin = req.nextUrl.origin;
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/telehealth`,
      return_url: `${origin}/telehealth`,
      type: "account_onboarding",
    });

    return NextResponse.json({ onboardingUrl: accountLink.url, accountId });
  } catch (err) {
    console.error("[admin/connect-onboard] error:", err);
    return NextResponse.json({ error: "Failed to create onboarding link" }, { status: 500 });
  }
}

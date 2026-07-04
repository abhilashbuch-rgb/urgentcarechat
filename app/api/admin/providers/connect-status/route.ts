import { NextRequest, NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";
import { createServerClient } from "@/lib/supabase";

// ============================================================
// /api/admin/providers/connect-status — Re-checks a provider's Stripe
// Connect account directly with Stripe (no webhook needed) and updates
// stripe_onboarded once payouts are actually enabled. Call this after
// the provider says they've completed onboarding. Protected by
// ADMIN_SECRET.
// ============================================================

export async function GET(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providerId = req.nextUrl.searchParams.get("providerId");
  if (!providerId) {
    return NextResponse.json({ error: "Missing providerId" }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const { data: provider, error } = await supabase
      .from("providers")
      .select("id, stripe_account_id")
      .eq("id", providerId)
      .maybeSingle();

    if (error || !provider || !provider.stripe_account_id) {
      return NextResponse.json(
        { error: "Provider not found or has no Stripe account yet" },
        { status: 404 }
      );
    }

    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(provider.stripe_account_id);
    const onboarded = !!account.payouts_enabled && !!account.charges_enabled;

    await supabase
      .from("providers")
      .update({ stripe_onboarded: onboarded })
      .eq("id", providerId);

    return NextResponse.json({
      onboarded,
      detailsSubmitted: account.details_submitted,
      payoutsEnabled: account.payouts_enabled,
      chargesEnabled: account.charges_enabled,
    });
  } catch (err) {
    console.error("[admin/connect-status] error:", err);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}

import { getStripeClient } from "./stripe";
import { createServerClient } from "./supabase";

// Shared by the admin-triggered and provider self-service onboarding
// routes: creates a Stripe Express connected account if the provider
// doesn't have one yet, then returns a fresh one-time onboarding link.
export async function getOrCreateOnboardingLink(
  providerId: string,
  currentAccountId: string | null,
  origin: string,
  returnPath: string
): Promise<{ onboardingUrl: string; accountId: string }> {
  const stripe = getStripeClient();
  let accountId = currentAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      capabilities: { transfers: { requested: true } },
      business_type: "individual",
    });
    accountId = account.id;

    const supabase = createServerClient();
    const { error: updateErr } = await supabase
      .from("providers")
      .update({ stripe_account_id: accountId })
      .eq("id", providerId);

    if (updateErr) {
      console.error("[stripe-connect] failed to save account id:", updateErr);
    }
  }

  // refresh_url/return_url must be pages the PROVIDER's browser can load
  // without any extra auth — if the link expires mid-onboarding, they
  // (or the admin, for admin-triggered onboarding) need a fresh one.
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}${returnPath}`,
    return_url: `${origin}${returnPath}`,
    type: "account_onboarding",
  });

  return { onboardingUrl: accountLink.url, accountId };
}

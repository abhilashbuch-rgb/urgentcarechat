import Stripe from "stripe";

// Server-side Stripe client for the telehealth platform-fee checkout.
export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY env var");
  }
  return new Stripe(key);
}

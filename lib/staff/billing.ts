import type { StaffSql } from "@/lib/staff/db";

// Billing state, for the one thing the UI needs to know: whether new
// entries can be filed.
//
// This is a READ of the state the webhook maintains. Nothing in the app
// writes it — a subscription changes because Stripe said so, over a
// signed webhook, and nowhere else.

export interface BillingState {
  is_read_only: boolean;
  subscription_status: string;
  read_only_since: string | null;
}

export async function billingState(
  sql: StaffSql,
  org: string
): Promise<BillingState> {
  const rows = await sql<BillingState[]>`
    select is_read_only, subscription_status,
           read_only_since::text as read_only_since
      from staff.orgs where slug = ${org}
  `;
  // An org row that cannot be read means RLS is doing its job on a request
  // that has no business here; treating that as "not read-only" would be
  // the wrong direction, but so would blocking, since the caller already
  // passed authentication. Default to writable and let RLS refuse the
  // write itself.
  return (
    rows[0] ?? {
      is_read_only: false,
      subscription_status: "unknown",
      read_only_since: null,
    }
  );
}

/**
 * The Payment Link an administrator is sent to when the clinic is
 * read-only, or null when none is configured.
 *
 * A LINK, NOT A CHECKOUT SESSION. This integration deliberately makes no
 * Stripe API calls (see lib/staff/stripe.ts): checkout is a Payment Link
 * and card changes are the no-code Customer Portal, both configured in
 * the dashboard. Creating sessions here would mean carrying the SDK, a
 * price ID in code, and a second place for the price to be wrong.
 *
 * VALIDATED, BECAUSE THIS IS A LINK WE ASK PEOPLE TO PUT A CARD INTO.
 * Only Stripe's own hosted domains are accepted. A mistyped or
 * substituted value must fail closed and leave the banner with no link at
 * all, rather than send a clinic administrator to somebody else's page
 * with our wording around it.
 */
/**
 * @param forSlug When set, appended as client_reference_id — the same
 * Payment Link, aimed at a specific clinic rather than a new signup. The
 * Stripe webhook already looks for this on checkout.session.completed to
 * attach the resulting subscription to an EXISTING org slug instead of
 * provisioning a new one (see app/api/webhooks/stripe/route.ts) — built
 * for exactly this: an owner paying to activate a second clinic they
 * just added, on the one price, no new Stripe object required.
 */
export function paymentLink(forSlug?: string): string | null {
  const raw = process.env.STRIPE_PAYMENT_LINK?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const ok = host === "buy.stripe.com" || host.endsWith(".stripe.com");
  if (!ok) return null;
  if (forSlug) url.searchParams.set("client_reference_id", forSlug);
  return url.toString();
}

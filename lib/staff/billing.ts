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

/**
 * The no-code Customer Portal's own static link, or null when none is
 * configured. Same shape and same reason as paymentLink() above — no
 * Stripe API call, no session to create, just a link Stripe's own page
 * asks a visitor's email against before showing anything. An owner
 * lands there to see their invoices, change the card on file, or
 * cancel; none of that touches this app's database directly — the
 * webhook is still the only writer of subscription_status.
 *
 * VALIDATED THE SAME WAY: only Stripe's own hosted domain is accepted,
 * for the same reason a mistyped value must fail closed rather than
 * send an owner to put a card into somebody else's page.
 */
export function customerPortalLink(): string | null {
  const raw = process.env.STRIPE_CUSTOMER_PORTAL_LINK?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const ok = host === "billing.stripe.com" || host.endsWith(".stripe.com");
  if (!ok) return null;
  return url.toString();
}

/**
 * A one-click, already-authenticated Customer Portal session — the
 * "proper" integration over the static link above. This is the one
 * Stripe API call this codebase makes: POST billing_portal/sessions,
 * Basic-auth'd with a secret key, returning a session whose url skips
 * the email-then-magic-code step every visitor to the static link sits
 * through first.
 *
 * OPTIONAL BY DESIGN. STRIPE_SECRET_KEY may not be configured at all —
 * this integration ran for months on Payment Links and the no-code
 * portal alone — in which case this returns null and the caller falls
 * back to customerPortalLink(). A portal session is single-use and
 * short-lived, so nothing here is cached; every call makes a fresh one.
 *
 * Requires a Customer Portal configuration to already exist in the
 * Stripe dashboard (Settings -> Billing -> Customer portal). Without
 * one, Stripe's own API rejects the request and this returns null the
 * same as a missing key — there is nothing this function can configure
 * on its own behalf.
 */
export async function createPortalSession(
  customerId: string,
  returnUrl?: string
): Promise<string | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  const body = new URLSearchParams({ customer: customerId });
  const configId = process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim();
  if (configId) body.set("configuration", configId);
  if (returnUrl) body.set("return_url", returnUrl);

  try {
    const res = await fetch(
      "https://api.stripe.com/v1/billing_portal/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) {
      console.error("[billing] portal session request failed:", res.status);
      return null;
    }
    const data = (await res.json()) as { url?: string };
    return typeof data.url === "string" ? data.url : null;
  } catch (err) {
    console.error(
      "[billing] portal session request errored:",
      err instanceof Error ? err.message : "Unknown"
    );
    return null;
  }
}

/** Plain-English label for a Stripe subscription status. Falls back to
 *  the raw value for anything not seen in practice yet (see
 *  app/api/webhooks/stripe/route.ts, which passes some statuses through
 *  verbatim) rather than guessing at a label for a state nobody has
 *  actually observed. */
export function planStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    trialing: "Trial",
    active: "Active",
    past_due: "Payment failed",
    canceled: "Canceled",
    unpaid: "Unpaid",
    incomplete: "Incomplete",
    incomplete_expired: "Incomplete (expired)",
    paused: "Paused",
  };
  return labels[status] ?? status;
}

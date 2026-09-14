import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { redirectTo } from "@/lib/staff/http";
import { createPortalSession, customerPortalLink } from "@/lib/staff/billing";
import { ROOT_URL } from "@/lib/site";

// GET /api/staff/billing-portal — the one link Stripe's own page for
// invoices, the card on file, and cancelling.
//
// Tries the session-based portal first (see createPortalSession — one
// authenticated call, already signed in as this clinic's customer),
// falls back to the static no-code link when no secret key is
// configured, and to a plain explanation when neither is. Owner-only,
// same reasoning as billing-contact: this is a doorway to changing the
// card on file and cancelling the subscription, not a manager's call.

export const runtime = "nodejs";

export async function GET() {
  const auth = await resolve();
  if (!auth.ok) return redirectTo(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "org_admin")) {
    return redirectTo("/staff/settings?e=billingforbidden");
  }

  const [row] = await withSession(session, (sql) =>
    sql<{ stripe_customer_id: string | null }[]>`
      select stripe_customer_id from staff.orgs where slug = ${org}
    `
  );
  const customerId = row?.stripe_customer_id ?? null;
  if (!customerId) return redirectTo("/staff/settings?e=nobilling");

  const sessionUrl = await createPortalSession(
    customerId,
    `${ROOT_URL}/staff/settings`
  );
  if (sessionUrl) return redirectTo(sessionUrl);

  const fallback = customerPortalLink();
  if (fallback) return redirectTo(fallback);

  return redirectTo("/staff/settings?e=noportal");
}

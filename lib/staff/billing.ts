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

import type { StaffSql } from "@/lib/staff/db";
import { withOrg } from "@/lib/staff/db";

// Reading a hauler's confirmation email and moving the pickup obligation
// to match — the automated version of the "Move" button already on
// /staff/obligations/[id]. Same underlying write; this is just what
// triggers it.
//
// FAILS SAFE, ALWAYS. An email that doesn't check out — wrong sender,
// wording that doesn't parse, no open obligation to move — changes
// nothing. Guessing wrong on a regulated deadline is worse than leaving
// it for a person to notice, so every rejection is logged and nothing
// is ever half-applied.
//
// ONE HAULER TODAY, NAMED RATHER THAN CONFIGURABLE. Sharps Compliance is
// the only one this was built against, and the exact phrase this
// matches ("scheduled for M/D/YYYY") is theirs, verbatim, from a real
// reminder. Generalizing to "any hauler's wording" before a second one
// exists to test against would be guessing at a format nobody has
// asked for yet.

const SHARPS_SENDER_DOMAIN = "sharpsinc.com";

// The obligation this pipeline is allowed to move. Same reasoning as
// the calendar tokens being scoped to one key rather than the whole
// register — an inbound email pipeline that could move ANY obligation
// by guessing its key is a much bigger blast radius than the one this
// was asked to solve.
const ALLOWED_KEY = "rmw-pickup";

// The domain mail actually lands on. An env var rather than a literal,
// because which domain this ends up being is still an open question —
// see the header of app/api/webhooks/resend-inbound/route.ts and the
// PR this shipped on — and a page telling an administrator to forward
// mail to the wrong address is worse than one that says setup isn't
// finished yet.
const INBOUND_DOMAIN = process.env.WASTE_PICKUP_INBOUND_DOMAIN ?? "inbound.medicin.io";

/** Whether an inbound domain has actually been configured, as opposed
 *  to the fallback default sitting there unconfigured. The settings
 *  page uses this to say "not set up yet" instead of handing out an
 *  address that goes nowhere. */
export function inboundConfigured(): boolean {
  return Boolean(process.env.WASTE_PICKUP_INBOUND_DOMAIN);
}

/** The inverse of orgFromRecipient() — the address an administrator
 *  should set their email to forward Sharps' confirmations to. */
export function forwardingAddress(org: string): string {
  return `waste-pickup+${org}@${INBOUND_DOMAIN}`;
}

export function isFromSharps(fromHeader: string): boolean {
  const match = fromHeader.match(/[^<\s]+@[^>\s]+/);
  const address = (match?.[0] ?? fromHeader).toLowerCase();
  return address.endsWith(`@${SHARPS_SENDER_DOMAIN}`);
}

/** The org slug out of the recipient address, e.g.
 *  "waste-pickup+afc-narberth@inbound.medicin.io" -> "afc-narberth".
 *  Plain slug rather than a minted token: the sender check above is
 *  the actual guard, and an org slug isn't a secret — see
 *  staff-multisite.sql, where it's already visible in tenant subdomains. */
export function orgFromRecipient(toAddress: string): string | null {
  const match = toAddress.match(/^waste-pickup\+([a-z0-9-]+)@/i);
  return match ? match[1].toLowerCase() : null;
}

/** "...scheduled for 9/21/2026 during..." -> "2026-09-21". Null for
 *  anything that doesn't match, including a syntactically fine but
 *  impossible date (2/30) — Date's own rollover would otherwise turn a
 *  typo into a wrong-but-valid-looking pickup date. */
export function parsePickupDate(text: string): string | null {
  const match = text.match(/scheduled for (\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);

  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type ApplyResult =
  | { ok: true; obligationId: string; previousDueOn: string }
  | { ok: false; reason: "no_open_obligation" };

/** Moves the CURRENT open occurrence of ALLOWED_KEY to dueOn, and
 *  records who moved it (nobody — actor_id null, same as the platform's
 *  own automated writes elsewhere) alongside what triggered it. Mirrors
 *  the "reschedule" action in
 *  app/api/staff/obligations/[id]/route.ts exactly, minus the session
 *  it has no equivalent of. */
export async function applyPickupDate(org: string, dueOn: string): Promise<ApplyResult> {
  return withOrg(org, "platform_super_admin", async (sql) => {
    const rows = await sql<{ id: string; title: string; due_on: string }[]>`
      select id, title, due_on::text as due_on
        from staff.obligations
       where org_slug = ${org} and key = ${ALLOWED_KEY}
         and completed_at is null and active
       limit 1
    `;
    const ob = rows[0];
    if (!ob) return { ok: false, reason: "no_open_obligation" };

    await sql`update staff.obligations set due_on = ${dueOn}::date where id = ${ob.id}`;
    await sql`
      insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
      values (${org}, null, 'obligation_rescheduled_auto', 'obligation', ${ob.id},
              ${sql.json({ title: ob.title, previous_due_on: ob.due_on, due_on: dueOn,
                           source: "sharps_inbound_email" })})
    `;
    return { ok: true, obligationId: ob.id, previousDueOn: ob.due_on };
  });
}

/** A rejection, logged where the clinic can find it — same audit_log
 *  the successful path writes to, just a different action name. Only
 *  called once an org has actually been resolved; a misdirected or
 *  spam email with no real clinic behind it has nowhere useful to log
 *  to and is handled by the caller instead (console only). */
export async function logRejection(
  org: string,
  reason: string,
  detail: Record<string, string | null>
): Promise<void> {
  await withOrg(org, "platform_super_admin", (sql) =>
    sql`
      insert into staff.audit_log (org_slug, actor_id, action, entity, detail)
      values (${org}, null, 'waste_pickup_email_rejected', 'obligation',
              ${sql.json({ reason, ...detail })})
    `
  );
}

export const ALLOWED_OBLIGATION_KEY = ALLOWED_KEY;

export interface InboundActivity {
  created_at: string;
  action: "obligation_rescheduled_auto" | "waste_pickup_email_rejected";
  detail: Record<string, string | null>;
}

/** The last few things this pipeline has done to THIS org's mailbox —
 *  read under the caller's own session, not the platform role the
 *  writes above use, so it comes back scoped by ordinary RLS same as
 *  everything else an administrator reads. */
export async function recentInboundActivity(
  sql: StaffSql,
  limit = 10
): Promise<InboundActivity[]> {
  return sql<InboundActivity[]>`
    select created_at::text as created_at, action, detail
      from staff.audit_log
     where action in ('obligation_rescheduled_auto', 'waste_pickup_email_rejected')
     order by created_at desc
     limit ${limit}
  `;
}

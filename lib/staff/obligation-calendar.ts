import type { StaffSql } from "@/lib/staff/db";
import { withOrg } from "@/lib/staff/db";
import { mintToken, hashToken } from "@/lib/staff/surveyor";
import { ROOT_URL } from "@/lib/site";

// Subscribable calendar links for one obligation at a time. See the
// header of supabase/staff-obligation-calendar.sql for why this is
// scoped to a KEY rather than the whole register, and why it borrows
// staff.surveyor_tokens' shape (bearer link, hash stored, revocable)
// rather than staff.surveyor_tokens itself: an inspector's link expires
// in days on purpose, and a calendar subscription is meant to keep
// working until an administrator revokes it.

export interface IssuedCalendarLink {
  id: string;
  url: string;
}

export async function issueCalendarLink(
  sql: StaffSql,
  args: { org: string; key: string; label: string; createdBy: string }
): Promise<IssuedCalendarLink> {
  const token = mintToken();
  const [row] = await sql<{ id: string }[]>`
    insert into staff.obligation_calendar_tokens
      (org_slug, key, token_hash, label, created_by)
    values
      (${args.org}, ${args.key}, ${hashToken(token)}, ${args.label}, ${args.createdBy})
    returning id
  `;
  return { id: row.id, url: `${ROOT_URL}/api/obligations-calendar/${token}` };
}

export async function revokeCalendarLink(
  sql: StaffSql,
  args: { id: string; by: string }
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update staff.obligation_calendar_tokens
       set revoked_at = now(), revoked_by = ${args.by}
     where id = ${args.id} and revoked_at is null
    returning id
  `;
  return rows.length > 0;
}

export interface CalendarAccessRow {
  id: string;
  label: string;
  created_at: string;
  first_fetched_at: string | null;
  last_fetched_at: string | null;
  fetch_count: number;
  created_by_name: string | null;
  state: "active" | "revoked" | "unopened";
}

export async function calendarLinksFor(
  sql: StaffSql,
  key: string
): Promise<CalendarAccessRow[]> {
  return sql<CalendarAccessRow[]>`
    select id, label,
           created_at::text as created_at,
           first_fetched_at::text as first_fetched_at,
           last_fetched_at::text as last_fetched_at,
           fetch_count, created_by_name, state
      from staff.obligation_calendar_access
     where key = ${key}
     order by created_at desc
  `;
}

export interface CalendarRedeem {
  org: string;
  key: string;
  label: string;
}

/**
 * Turn a token into an org + key, or null. No session exists here —
 * same reasoning as lib/staff/surveyor.ts's redeem(): the org is the
 * ANSWER, not an input, so this runs the SECURITY DEFINER lookup under
 * a bare, org-less connection before any RLS scoping is possible.
 */
export async function redeemCalendarToken(token: string): Promise<CalendarRedeem | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const rows = await withOrg("", "calendar_feed", (sql) =>
    sql<{ org_slug: string; key: string; label: string }[]>`
      select org_slug, key, label from staff.redeem_calendar_token(${hashToken(token)})
    `
  );
  const row = rows[0];
  if (!row) return null;
  return { org: row.org_slug, key: row.key, label: row.label };
}

export interface CurrentOccurrence {
  title: string;
  detail: string | null;
  citation: string | null;
  due_on: string;
}

/** The obligation's current open occurrence — see the header of
 *  staff-obligation-calendar.sql on why a KEY resolves to whichever row
 *  is open right now rather than a fixed id. Null when there is
 *  currently nothing open under this key (retired, or between
 *  completion and the next occurrence existing) — a valid, if boring,
 *  state for a feed to report. */
export async function currentOccurrence(
  org: string,
  key: string
): Promise<CurrentOccurrence | null> {
  const rows = await withOrg(org, "calendar_feed", (sql) =>
    sql<CurrentOccurrence[]>`
      select title, detail, citation, due_on::text as due_on
        from staff.obligation_register
       where key = ${key} and status != 'done'
       order by due_on
       limit 1
    `
  );
  return rows[0] ?? null;
}

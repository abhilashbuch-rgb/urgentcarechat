import type { StaffSql } from "@/lib/staff/db";

// What this person, in this job, still owes this shift.
//
// The Today page used to answer questions nobody had: the organization's
// name, the number of active team members, how row-level security
// resolves the hostname. Those are facts about the software, printed on
// the screen of somebody who came to log a fridge temperature before the
// doors open.
//
// This answers the two questions a medical assistant actually has, in
// the order they have them: how much is left, and what is next.

export interface NextCheck {
  slug: string;
  name: string;
  slot: string;
}

export interface ShiftState {
  due: number;
  done: number;
  flagged: number;
  next: NextCheck | null;
}

/**
 * Scoped to this person's job by the same brief_matches() the board
 * uses, so what Today counts and what Logs lists cannot disagree. A
 * count that says three while the board shows five is worse than no
 * count at all.
 */
export async function shiftState(
  sql: StaffSql,
  jobRole: string | null
): Promise<ShiftState> {
  const rows = await sql<
    {
      slug: string;
      name: string;
      slot: string;
      response_id: string | null;
      has_out_of_range: boolean | null;
      sort_order: number;
    }[]
  >`
    select slug, name, slot, response_id, has_out_of_range, sort_order
      from staff.todays_logs
     where staff.brief_matches(job_roles, ${jobRole}::staff.job_role)
     order by sort_order, slot
  `;

  const outstanding = rows.filter((r) => !r.response_id);
  const first = outstanding[0];

  return {
    due: outstanding.length,
    done: rows.length - outstanding.length,
    flagged: rows.filter((r) => r.has_out_of_range).length,
    // The next thing, not a list of things. A list is what /staff/logs
    // is for; this is the one tap that skips it.
    next: first
      ? { slug: first.slug, name: first.name, slot: first.slot }
      : null,
  };
}

export interface ExpiringCredential {
  kind_label: string;
  expires_on: string | null;
  days_left: number | null;
  status: string;
}

/**
 * This person's own credentials, and only theirs.
 *
 * The one item on a medical assistant's screen that serves them rather
 * than the clinic: it is their licence, their card, and their problem if
 * it lapses. Everything else they see is evidence somebody else will
 * read.
 *
 * Quiet unless something is actually approaching — a permanent row
 * saying "all current" is another thing to stop seeing.
 */
export async function myCredentialWarnings(
  sql: StaffSql,
  userId: string
): Promise<ExpiringCredential[]> {
  return sql<ExpiringCredential[]>`
    select
           -- The stored label is a column heading on the accreditation
           -- matrix, where the cell beside it holds a date: "BLS / CPR
           -- expires". Here the value beside it is a state, so the word
           -- would read twice — "BLS / CPR expires · Expires in 34 days".
           -- The backslash is doubled because this is a template literal
           -- before it is SQL: a lone \s cooks away to a bare "s".
           regexp_replace(kind_label, '\\s+expires$', '') as kind_label,
           expires_on::text as expires_on, days_left, status
      from staff.credential_matrix
     where user_id = ${userId}
       and required
       and status in ('expired', 'expiring', 'missing')
     order by
       case status when 'expired' then 0 when 'missing' then 1 else 2 end,
       days_left nulls last
     limit 4
  `;
}

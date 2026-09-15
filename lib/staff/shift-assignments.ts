import type { StaffSql } from "@/lib/staff/db";

// One date, one job, one name — no login required. See the header of
// supabase/staff-shift-assignments.sql for why this is a per-date
// assignment rather than a recurring pattern or a standing placeholder
// profile.

export interface ShiftAssignment {
  id: string;
  work_date: string;
  job_role: string;
  name: string;
}

/** Upcoming assignments, for the Team screen's own list — today
 *  forward, not the whole history, since a manager filling these in is
 *  looking ahead, not auditing the past. */
export async function upcomingAssignments(sql: StaffSql, org: string): Promise<ShiftAssignment[]> {
  return sql<ShiftAssignment[]>`
    select id, work_date::text as work_date, job_role, name
      from staff.shift_assignments
     where org_slug = ${org} and work_date >= current_date
     order by work_date, job_role, name
  `;
}

export async function createAssignment(
  sql: StaffSql,
  org: string,
  createdBy: string,
  workDate: string,
  jobRole: string,
  name: string
): Promise<void> {
  await sql`
    insert into staff.shift_assignments (org_slug, work_date, job_role, name, created_by)
    values (${org}, ${workDate}, ${jobRole}::staff.job_role, ${name}, ${createdBy})
  `;
}

/** Org isolation is RLS's job (staff-shift-assignments.sql); who's
 *  ALLOWED to call this at all is the API route's — same split as
 *  deleteBulletin() in lib/staff/bulletins.ts. */
export async function deleteAssignment(sql: StaffSql, id: string): Promise<void> {
  await sql`delete from staff.shift_assignments where id = ${id}`;
}

/** Today's assignments only, grouped by job — what onDutyToday() folds
 *  into its own real-account roster. Reads the clinic's own timezone
 *  the same way onDutyToday() does, so "today" cannot disagree between
 *  the two halves of one banner. */
export async function assignmentsToday(
  sql: StaffSql,
  org: string
): Promise<{ job_role: string; name: string }[]> {
  return sql<{ job_role: string; name: string }[]>`
    select a.job_role, a.name
      from staff.shift_assignments a
      join staff.orgs o on o.slug = a.org_slug
     where a.org_slug = ${org}
       and a.work_date = (now() at time zone o.timezone)::date
     order by a.job_role, a.name
  `;
}

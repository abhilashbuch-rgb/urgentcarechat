import type { StaffSql } from "@/lib/staff/db";

// What this clinic's subscription includes, by job, and what it is using.
//
// The counting lives in staff.seat_usage — see supabase/staff-seats.sql
// for why it is by job rather than one headcount, and why going over
// blocks nobody.

export interface SeatRow {
  job_role: string;
  included: number;
  is_override: boolean;
  in_use: number;
  invited_not_yet_in: number;
  over_by: number;
}

export async function seatUsage(sql: StaffSql): Promise<SeatRow[]> {
  return sql<SeatRow[]>`
    select job_role::text as job_role, included, is_override,
           in_use::int as in_use,
           invited_not_yet_in::int as invited_not_yet_in,
           over_by::int as over_by
      from staff.seat_usage
     order by
       -- Over first, then the ones filling up, then the quiet ones. An
       -- administrator opening this wants the exception, not the roster.
       over_by desc,
       case when included = 0 then 0 else in_use::numeric / included end desc,
       job_role
  `;
}

export async function unassignedCount(sql: StaffSql): Promise<number> {
  const rows = await sql<{ unassigned: string }[]>`
    select unassigned::text from staff.seat_unassigned
  `;
  return Number(rows[0]?.unassigned ?? 0);
}

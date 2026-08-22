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
  extra_seat_cents: number;
  extra_cents: number;
}

export interface SeatBill {
  extra_seats: number;
  extra_cents: number;
}

export async function seatUsage(sql: StaffSql): Promise<SeatRow[]> {
  return sql<SeatRow[]>`
    select job_role::text as job_role, included, is_override,
           in_use::int as in_use,
           invited_not_yet_in::int as invited_not_yet_in,
           over_by::int as over_by,
           extra_seat_cents::int as extra_seat_cents,
           extra_cents::int as extra_cents
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

/** What this clinic is adding to its invoice this month, if anything. */
export async function seatBill(sql: StaffSql): Promise<SeatBill> {
  const rows = await sql<{ extra_seats: number; extra_cents: number }[]>`
    select extra_seats::int as extra_seats, extra_cents::int as extra_cents
      from staff.seat_bill
  `;
  return rows[0] ?? { extra_seats: 0, extra_cents: 0 };
}

/** Whole dollars where it divides evenly, because $25 reads faster than
 *  $25.00 and every price in this product is a round number today. */
export function money(cents: number): string {
  return cents % 100 === 0
    ? `$${cents / 100}`
    : `$${(cents / 100).toFixed(2)}`;
}

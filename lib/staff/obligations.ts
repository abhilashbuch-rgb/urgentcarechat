import type { StaffSql } from "@/lib/staff/db";

// The obligations register.
//
// Status is never stored and never passed in — it comes out of
// staff.obligation_register, which derives it from the due date at read
// time. Nothing in this file decides whether something is overdue; if it
// did, the app and the database would eventually disagree about it on a
// day that mattered.

export type ObligationStatus = "overdue" | "due_soon" | "scheduled" | "done";

export interface Obligation {
  id: string;
  key: string;
  title: string;
  detail: string | null;
  category: string | null;
  citation: string | null;
  source: string | null;
  due_on: string;
  days_out: number;
  status: ObligationStatus;
  repeat_months: number | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_active: boolean | null;
  completed_at: string | null;
  completed_by_name: string | null;
  completed_by_email: string | null;
  evidence_note: string | null;
  was_reopened: boolean;
  history: HistoryEntry[];
}

export interface HistoryEntry {
  completed_at: string | null;
  completed_by: string | null;
  evidence_note: string | null;
  reopened_at: string | null;
  reason: string | null;
}

export interface ObligationSummary {
  overdue: number;
  due_soon: number;
  unowned: number;
  next_due_on: string | null;
}

/** The whole register, ordered the way it has to be read: what is late
 *  first, then what is next, with everything already done at the bottom
 *  rather than removed. A register that hides completed items can't
 *  answer "when did we last do the risk analysis", which is the question
 *  a surveyor actually asks. */
export async function register(sql: StaffSql): Promise<Obligation[]> {
  return sql<Obligation[]>`
    select id, key, title, detail, category, citation, source,
           due_on::text as due_on, days_out, status, repeat_months,
           owner_id, owner_name, owner_email, owner_active,
           completed_at::text as completed_at,
           completed_by_name, completed_by_email, evidence_note,
           was_reopened, history
      from staff.obligation_register
     order by
       case status
         when 'overdue'  then 0
         when 'due_soon' then 1
         when 'scheduled' then 2
         else 3
       end,
       -- Within "done", most recent first; everywhere else, soonest first.
       case when status = 'done' then null else due_on end asc nulls last,
       completed_at desc nulls last,
       title
  `;
}

export async function getObligation(
  sql: StaffSql,
  id: string
): Promise<Obligation | null> {
  const rows = await sql<Obligation[]>`
    select id, key, title, detail, category, citation, source,
           due_on::text as due_on, days_out, status, repeat_months,
           owner_id, owner_name, owner_email, owner_active,
           completed_at::text as completed_at,
           completed_by_name, completed_by_email, evidence_note,
           was_reopened, history
      from staff.obligation_register where id = ${id}
  `;
  return rows[0] ?? null;
}

export async function summary(
  sql: StaffSql,
  org: string
): Promise<ObligationSummary> {
  const rows = await sql<ObligationSummary[]>`
    select overdue, due_soon, unowned, next_due_on::text as next_due_on
      from staff.obligation_summary where org_slug = ${org}
  `;
  // No row means no obligations at all, not an error — a register that
  // has been emptied out is a legitimate (if unusual) state.
  return rows[0] ?? { overdue: 0, due_soon: 0, unowned: 0, next_due_on: null };
}

// ---------------------------------------------------------------------
// Labels
//
// All of this is presentational, and all of it is computed from days_out
// rather than by re-parsing the date, so the browser's clock and the
// database's clock can't produce different answers about what is late.
// ---------------------------------------------------------------------

export function dueLabel(daysOut: number): string {
  if (daysOut < -1) return `${Math.abs(daysOut)} days overdue`;
  if (daysOut === -1) return "1 day overdue";
  if (daysOut === 0) return "Due today";
  if (daysOut === 1) return "Due tomorrow";
  if (daysOut <= 30) return `Due in ${daysOut} days`;
  const months = Math.round(daysOut / 30);
  return months === 1 ? "Due in a month" : `Due in ${months} months`;
}

export function repeatLabel(months: number | null): string | null {
  if (!months) return null;
  if (months === 1) return "Monthly";
  if (months === 3) return "Quarterly";
  if (months === 6) return "Twice a year";
  if (months === 12) return "Annually";
  if (months === 24) return "Every two years";
  return `Every ${months} months`;
}

export const STATUS_LABELS: Record<ObligationStatus, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  scheduled: "Scheduled",
  done: "Done",
};

/** The date, spelled out. Parsed as a plain calendar date — appending a
 *  timezone would shift a due date across midnight for anyone west of
 *  UTC, which turns "due today" into "one day overdue" on the same
 *  screen the database called scheduled. */
export function formatDue(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export const CATEGORIES = [
  "HIPAA",
  "OSHA",
  "Life safety",
  "Clinical",
  "Laboratory",
  "Employment",
  "Other",
] as const;

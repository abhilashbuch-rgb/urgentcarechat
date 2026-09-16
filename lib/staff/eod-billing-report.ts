import type { StaffSql } from "@/lib/staff/db";

// The billing specialist's end-of-day report. See the header of
// supabase/staff-eod-billing-report.sql for the structured-fields-not-
// prose reasoning; this file is the code side of the same decision.

export type BillingAction =
  | "payment_processed"
  | "write_off"
  | "charge_entry_check"
  | "claim_resubmit"
  | "balance_check"
  | "payment_issue"
  | "insurance_correction"
  | "other";

export const BILLING_ACTION_LABELS: Record<BillingAction, string> = {
  payment_processed: "Payment processed",
  write_off: "Write-off requested",
  charge_entry_check: "Please check charge entry",
  claim_resubmit: "Claim needs resubmitting",
  balance_check: "Balance needs review",
  payment_issue: "Payment couldn't be posted",
  insurance_correction: "Insurance details corrected",
  other: "Other",
};

export interface BillingEntry {
  id: string;
  reference_number: string;
  action: BillingAction;
  amount: string | null;
  note: string | null;
  needs_review: boolean;
  created_at: string;
}

export interface BillingReport {
  id: string;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  general_notes: string | null;
  general_notes_needs_review: boolean;
  finalized_at: string | null;
  submitted_by_name: string | null;
}

/** Today's report for this person, creating it if it doesn't exist yet
 *  — the unique (submitted_by, work_date) constraint makes this safe to
 *  call every time she opens the page, not just once. Clock in/out are
 *  only set on creation; reopening an existing day's report to add more
 *  entries shouldn't silently overwrite the time she already typed. */
export async function startOrGetReport(
  sql: StaffSql,
  org: string,
  userId: string,
  workDate: string,
  clockIn: string | null,
  clockOut: string | null
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into staff.eod_billing_reports
      (org_slug, submitted_by, work_date, clock_in, clock_out)
    values (${org}, ${userId}, ${workDate}, ${clockIn}, ${clockOut})
    on conflict (submitted_by, work_date) do update
      set clock_in = coalesce(staff.eod_billing_reports.clock_in, excluded.clock_in),
          clock_out = coalesce(staff.eod_billing_reports.clock_out, excluded.clock_out)
    returning id
  `;
  return row.id;
}

export async function addEntry(
  sql: StaffSql,
  org: string,
  reportId: string,
  referenceNumber: string,
  action: BillingAction,
  amount: string | null,
  note: string | null
): Promise<void> {
  const needsReview = scanForIdentifiers(note).length > 0;
  await sql`
    insert into staff.eod_billing_entries
      (org_slug, report_id, reference_number, action, amount, note, needs_review)
    values (${org}, ${reportId}, ${referenceNumber}, ${action}, ${amount}, ${note}, ${needsReview})
  `;
}

export async function finalizeReport(
  sql: StaffSql,
  reportId: string,
  generalNotes: string | null
): Promise<void> {
  const needsReview = scanForIdentifiers(generalNotes).length > 0;
  await sql`
    update staff.eod_billing_reports
       set general_notes = ${generalNotes},
           general_notes_needs_review = ${needsReview},
           finalized_at = now()
     where id = ${reportId}
  `;
}

export async function entriesFor(sql: StaffSql, reportId: string): Promise<BillingEntry[]> {
  return sql<BillingEntry[]>`
    select id, reference_number, action, amount::text as amount, note,
           needs_review, created_at::text as created_at
      from staff.eod_billing_entries
     where report_id = ${reportId}
     order by created_at
  `;
}

/** One person's own recent reports, most recent first — her own
 *  history, not anyone else's. */
export async function myReports(
  sql: StaffSql,
  userId: string,
  limit = 14
): Promise<BillingReport[]> {
  return sql<BillingReport[]>`
    select id, work_date::text as work_date, clock_in, clock_out,
           general_notes, general_notes_needs_review,
           finalized_at::text as finalized_at,
           null::text as submitted_by_name
      from staff.eod_billing_reports
     where submitted_by = ${userId}
     order by work_date desc
     limit ${limit}
  `;
}

/** Every report in the org, most recent first — the admin-review side.
 *  Gating who may call this is app/staff/billing-report/page.tsx's job,
 *  same as everywhere else in this schema. */
export async function orgReports(
  sql: StaffSql,
  org: string,
  limit = 30
): Promise<BillingReport[]> {
  return sql<BillingReport[]>`
    select r.id, r.work_date::text as work_date, r.clock_in, r.clock_out,
           r.general_notes, r.general_notes_needs_review,
           r.finalized_at::text as finalized_at,
           u.legal_name as submitted_by_name
      from staff.eod_billing_reports r
      join staff.users u on u.id = r.submitted_by
     where r.org_slug = ${org}
     order by r.work_date desc, r.created_at desc
     limit ${limit}
  `;
}

// ============================================================
// THE IDENTIFIER SCANNER — best-effort, not a guarantee.
//
// This exists to catch what free text tends to leak: a name written in
// prose, a date of birth, a Social Security number. It cannot catch
// every case — nothing pattern-matching a paragraph can, an insurance
// member ID that doesn't happen to match SSN's format sails through,
// and a name spelled in a way the heuristic below doesn't expect sails
// through too. It exists to warn and make her look again before saving,
// not to certify that a note is clean. Treat a pass here as "nothing
// obvious," never as "confirmed safe."
//
// THE ACCOUNT REFERENCE ITSELF IS NOT SCANNED — see the header of
// staff-eod-billing-report.sql for why that column is kept on purpose.
// ============================================================

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;
const DOB_PATTERN = /\b(dob|date of birth)\b/i;
// Two capitalized words in a row — "John Smith," "Mary Jane" — the
// single most common shape a name takes in a sentence. Flags real
// proper nouns too (a carrier name, a city), which is the right
// trade-off for a warning that asks a human to look, not a filter that
// silently deletes.
const NAME_LIKE_PATTERN = /\b[A-Z][a-z]+['’]?\s+[A-Z][a-z]+\b/;
const RELATIONAL_PATTERN =
  /\b(patient'?s?|his|her|their)\s+(mother|father|wife|husband|son|daughter|spouse|parent)\b/i;

export function scanForIdentifiers(text: string | null | undefined): string[] {
  if (!text) return [];
  const hits: string[] = [];
  if (SSN_PATTERN.test(text)) hits.push("looks like a Social Security number");
  if (DOB_PATTERN.test(text)) hits.push("mentions a date of birth");
  const name = text.match(NAME_LIKE_PATTERN);
  if (name) hits.push(`looks like it might contain a name ("${name[0]}")`);
  if (RELATIONAL_PATTERN.test(text)) hits.push('describes a family member — check for a name nearby');
  return hits;
}

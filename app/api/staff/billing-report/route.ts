import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import {
  startOrGetReport,
  addEntry,
  finalizeReport,
  type BillingAction,
} from "@/lib/staff/eod-billing-report";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/billing-report — the billing specialist's own
// end-of-day report. See the header of supabase/staff-eod-billing-
// report.sql for why this is structured fields plus a scanned note,
// not the free-text email it replaces.
//
// BILLING_SPECIALIST JOB ONLY, AND ONLY FOR THEIR OWN REPORT. An
// org_admin reviews this (app/staff/billing-report/page.tsx); nothing
// here lets anyone write into someone else's day.

export const runtime = "nodejs";

const VALID_ACTIONS: BillingAction[] = [
  "payment_processed",
  "write_off",
  "charge_entry_check",
  "claim_resubmit",
  "balance_check",
  "payment_issue",
  "insurance_correction",
  "other",
];

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  const form = await req.formData();
  const action = String(form.get("action") ?? "");

  try {
    const outcome = await withSession(session, async (sql) => {
      const me = await getProfile(sql, session.uid);
      if (me?.job_role !== "billing_specialist") return { error: "forbidden" as const };

      if (action === "start") {
        const workDate = String(form.get("work_date") ?? "");
        const clockIn = String(form.get("clock_in") ?? "").trim().slice(0, 100) || null;
        const clockOut = String(form.get("clock_out") ?? "").trim().slice(0, 100) || null;
        if (!workDate) return { error: "bad_request" as const };

        await startOrGetReport(sql, org, session.uid, workDate, clockIn, clockOut);
        return { ok: "started" as const };
      }

      if (action === "add_entry") {
        const reportId = String(form.get("report_id") ?? "");
        const referenceNumber = String(form.get("reference_number") ?? "").trim().slice(0, 100);
        const rawAction = String(form.get("billing_action") ?? "");
        const amountRaw = String(form.get("amount") ?? "").trim();
        const note = String(form.get("note") ?? "").trim().slice(0, 2000) || null;
        if (!reportId || !referenceNumber || !VALID_ACTIONS.includes(rawAction as BillingAction)) {
          return { error: "bad_request" as const };
        }
        // Owned by this person — a report_id from anywhere else must
        // fail closed rather than let one billing specialist's account
        // append an entry to another's day.
        const [owns] = await sql<{ id: string }[]>`
          select id from staff.eod_billing_reports
           where id = ${reportId} and submitted_by = ${session.uid}
        `;
        if (!owns) return { error: "not_found" as const };

        const amount = amountRaw && !Number.isNaN(Number(amountRaw)) ? amountRaw : null;
        await addEntry(sql, org, reportId, referenceNumber, rawAction as BillingAction, amount, note);
        return { ok: "entry_added" as const };
      }

      if (action === "finalize") {
        const reportId = String(form.get("report_id") ?? "");
        const generalNotes = String(form.get("general_notes") ?? "").trim().slice(0, 2000) || null;
        if (!reportId) return { error: "bad_request" as const };

        const [owns] = await sql<{ id: string }[]>`
          select id from staff.eod_billing_reports
           where id = ${reportId} and submitted_by = ${session.uid}
        `;
        if (!owns) return { error: "not_found" as const };

        await finalizeReport(sql, reportId, generalNotes);
        return { ok: "finalized" as const };
      }

      return { error: "bad_action" as const };
    });

    if ("error" in outcome) {
      return redirectAfterPost(`/staff/billing-report?e=${outcome.error}`);
    }
    return redirectAfterPost(`/staff/billing-report?done=${outcome.ok}`);
  } catch (err) {
    console.error(
      "[staff-billing-report] action failed:",
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/billing-report?e=server_error");
  }
}

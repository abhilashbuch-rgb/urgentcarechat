import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { atLeast } from "@/lib/staff/roles";
import { formatDate } from "@/lib/staff/labels";
import {
  startOrGetReport,
  entriesFor,
  myReports,
  orgReports,
  BILLING_ACTION_LABELS,
  type BillingAction,
} from "@/lib/staff/eod-billing-report";

// The billing specialist's end-of-day report — and, for an org_admin,
// the read-only review of everyone's. See the header of
// supabase/staff-eod-billing-report.sql for why this is structured
// fields and a scanned note rather than the free-text email it
// replaces, and lib/staff/eod-billing-report.ts's scanForIdentifiers()
// for exactly what gets flagged and what it cannot catch.
//
// ORG_ADMIN, NOT MANAGER, FOR THE REVIEW SIDE — a write-off is money,
// and a manager runs the team, not money. See RANK's own comment in
// lib/staff/roles.ts.

export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  started: "Today's report is open.",
  entry_added: "Added.",
  finalized: "Sent. Thank you.",
};
const ERRORS: Record<string, string> = {
  forbidden: "This page is for the billing specialist role.",
  bad_request: "That didn't go through. Nothing changed.",
  not_found: "Couldn't find that report.",
  bad_action: "Unrecognised action.",
  server_error: "That didn't go through. Nothing changed.",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function BillingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; e?: string }>;
}) {
  const { session, org } = await requireStaff();
  const { done, e } = await searchParams;

  const isReviewer = atLeast(session.role, "org_admin");

  const data = await withSession(session, async (sql) => {
    const me = await getProfile(sql, session.uid);
    const isSpecialist = me?.job_role === "billing_specialist";
    if (!isSpecialist && !isReviewer) return null;

    if (isSpecialist) {
      const workDate = todayISO();
      const reportId = await startOrGetReport(sql, org, session.uid, workDate, null, null);
      const entries = await entriesFor(sql, reportId);
      const history = await myReports(sql, session.uid);
      return { isSpecialist: true as const, reportId, workDate, entries, history };
    }

    const org_reports = await orgReports(sql, org);
    const withEntries = await Promise.all(
      org_reports.map(async (r) => ({ report: r, entries: await entriesFor(sql, r.id) }))
    );
    return { isSpecialist: false as const, org_reports: withEntries };
  });

  if (!data) redirect("/staff");

  return (
    <div className="st-page">
      <header className="st-page-head">
        <h1 className="st-h1">Billing report</h1>
        <p className="st-page-sub">
          {data.isSpecialist
            ? "One report per day. The account reference stays; nothing here is emailed or texted anywhere — it's read inside the app, same as opening the account directly would be."
            : "Every billing specialist's daily report, most recent first. Flagged items may contain more than an account reference — check before acting on them."}
        </p>
      </header>

      {(done || e) && (
        <div className={`st-notice${e ? " st-notice-warn" : ""}`} role={e ? "alert" : "status"}>
          <strong>{e ? "Not done" : "Done"}</strong>
          <span>{(e ? ERRORS[e] : NOTICES[done!]) ?? "Updated."}</span>
        </div>
      )}

      {data.isSpecialist ? (
        <>
          <section className="st-record-section">
            <h2 className="st-h2">Today &mdash; {formatDate(data.workDate)}</h2>

            {data.entries.length > 0 && (
              <ul className="st-billing-entries">
                {data.entries.map((entry) => (
                  <li key={entry.id} className="st-billing-entry">
                    <div className="st-billing-entry-main">
                      <span className="st-billing-ref">{entry.reference_number}</span>
                      <span className="st-billing-action">
                        {BILLING_ACTION_LABELS[entry.action]}
                        {entry.amount ? ` — $${entry.amount}` : ""}
                      </span>
                      {entry.needs_review && (
                        <span className="st-flag-gap" title="This note may contain more than an account reference — worth a second look.">
                          Review
                        </span>
                      )}
                    </div>
                    {entry.note && <p className="st-billing-note">{entry.note}</p>}
                  </li>
                ))}
              </ul>
            )}

            <form className="st-billing-form" method="POST" action="/api/staff/billing-report">
              <input type="hidden" name="action" value="add_entry" />
              <input type="hidden" name="report_id" value={data.reportId} />
              <label className="st-field">
                <span className="st-field-label">Account reference</span>
                <input className="st-input" type="text" name="reference_number" required placeholder="PID 336378" />
              </label>
              <label className="st-field">
                <span className="st-field-label">What happened</span>
                <select className="st-input" name="billing_action" defaultValue="payment_processed">
                  {Object.entries(BILLING_ACTION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="st-field">
                <span className="st-field-label">Amount (optional)</span>
                <input className="st-input" type="text" name="amount" placeholder="169.95" />
              </label>
              <label className="st-field" style={{ gridColumn: "1 / -1" }}>
                <span className="st-field-label">Note (no names, no dates of birth &mdash; the account reference above already says who)</span>
                <textarea className="st-input" name="note" rows={2} maxLength={2000} />
              </label>
              <button className="st-primary" type="submit">
                Add
              </button>
            </form>
          </section>

          <section className="st-record-section">
            <h2 className="st-h2">Send today&rsquo;s report</h2>
            <p className="st-page-sub" style={{ marginBottom: 12 }}>
              Anything from your other tasks &mdash; calls, emails, Workers&rsquo; Comp,
              Solv, the weekly clarification log &mdash; that isn&rsquo;t one of the
              entries above.
            </p>
            <form method="POST" action="/api/staff/billing-report">
              <input type="hidden" name="action" value="finalize" />
              <input type="hidden" name="report_id" value={data.reportId} />
              <textarea className="st-input" name="general_notes" rows={4} maxLength={2000} style={{ width: "100%", marginBottom: 12 }} />
              <button className="st-primary" type="submit">
                Send report
              </button>
            </form>
          </section>

          {data.history.length > 0 && (
            <section className="st-record-section">
              <h2 className="st-h2">Your recent reports</h2>
              <ul className="st-record-list">
                {data.history.map((r) => (
                  <li key={r.id} className="st-record-row">
                    <div className="st-record-main">
                      <span className="st-record-title">{formatDate(r.work_date)}</span>
                    </div>
                    <span className="st-record-when">
                      {r.finalized_at ? "Sent" : "Open"}
                      {r.general_notes_needs_review && " · flagged for review"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <section className="st-record-section">
          {data.org_reports.length === 0 ? (
            <p className="st-empty">No reports filed yet.</p>
          ) : (
            data.org_reports.map(({ report, entries }) => (
              <div key={report.id} className="st-billing-day">
                <h2 className="st-h2">
                  {formatDate(report.work_date)} &middot; {report.submitted_by_name ?? "unknown"}
                  {!report.finalized_at && " (not yet sent)"}
                </h2>
                {(report.clock_in || report.clock_out) && (
                  <p className="st-page-sub" style={{ marginBottom: 8 }}>
                    {report.clock_in ?? "—"} to {report.clock_out ?? "—"}
                  </p>
                )}
                {entries.length > 0 && (
                  <ul className="st-billing-entries">
                    {entries.map((entry) => (
                      <li key={entry.id} className="st-billing-entry">
                        <div className="st-billing-entry-main">
                          <span className="st-billing-ref">{entry.reference_number}</span>
                          <span className="st-billing-action">
                            {BILLING_ACTION_LABELS[entry.action as BillingAction]}
                            {entry.amount ? ` — $${entry.amount}` : ""}
                          </span>
                          {entry.needs_review && (
                            <span className="st-flag-gap" title="This note may contain more than an account reference — worth a second look.">
                              Review
                            </span>
                          )}
                        </div>
                        {entry.note && <p className="st-billing-note">{entry.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                {report.general_notes && (
                  <p className="st-billing-note">
                    {report.general_notes}
                    {report.general_notes_needs_review && (
                      <span className="st-flag-gap" style={{ marginLeft: 8 }}>
                        Review
                      </span>
                    )}
                  </p>
                )}
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}

import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { todaysBillingStats, billingContactEmail } from "@/lib/staff/billing-stats";

// Tonight's patient count for billing — separate from the EMR, which
// already carries the real count. See supabase/staff-billing-stats.sql
// for why this exists at all: one small number and a note, filed in the
// same motion as closing the front desk, so nobody has to log into a
// second system or make a call to get it to billing.

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  count: "Enter a whole number of patients, 0 or more.",
  save: "That didn't save. Nothing was changed — try again.",
};

export default async function BillingStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; sent?: string; e?: string }>;
}) {
  const { session, org } = await requireStaff();
  const { saved, sent, e } = await searchParams;

  const data = await withSession(session, async (sql) => ({
    today: await todaysBillingStats(sql, org),
    hasContact: Boolean(await billingContactEmail(sql, org)),
  }));

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <h1 className="st-h1">Tonight&rsquo;s patient count</h1>
        <p className="st-page-sub">
          For billing, not the record &mdash; a quick number and a note, not
          a compliance log.
        </p>
      </header>

      {saved && (
        <div className="st-notice" role="status">
          <strong>Saved.</strong>
          <span>
            {sent === "ok"
              ? "Sent to billing as a PDF."
              : sent === "failed"
                ? "Saved, but the email to billing didn't go through — try saving again, or tell an administrator."
                : data.hasContact
                  ? "Nothing was sent — mail isn't set up on this deployment yet."
                  : "Nothing was sent. No billing contact is set for this clinic yet — an owner can add one on the Settings page."}
          </span>
        </div>
      )}
      {e && ERRORS[e] && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>Not saved</strong>
          <span>{ERRORS[e]}</span>
        </div>
      )}

      <form className="st-log" method="POST" action="/api/staff/billing-stats">
        <section className="st-set-block">
          <label className="st-field">
            <span className="st-field-label">Patients seen today</span>
            <input
              className="st-input"
              name="patient_count"
              type="number"
              min={0}
              max={2000}
              step={1}
              required
              defaultValue={data.today?.patient_count ?? ""}
            />
          </label>

          <label className="st-field">
            <span className="st-field-label">Notes for billing (optional)</span>
            <textarea
              className="st-input"
              name="notes"
              rows={3}
              maxLength={500}
              defaultValue={data.today?.notes ?? ""}
              placeholder="Anything billing should know about tonight — a system outage, a payer issue, whatever's relevant."
            />
          </label>

          {data.today && (
            <p className="st-field-hint">
              Already filed tonight by {data.today.submitted_by_name ?? "someone"}.
              Saving again corrects it and resends.
            </p>
          )}
        </section>

        <button className="st-primary" type="submit">
          {data.hasContact ? "Save and send to billing" : "Save"}
        </button>
      </form>

      <p className="st-foot">
        Your EMR already has tonight&rsquo;s real count. This isn&rsquo;t a
        second record of it &mdash; it&rsquo;s a fast way to get that number
        in front of billing without a separate login or a phone call.
      </p>
    </div>
  );
}

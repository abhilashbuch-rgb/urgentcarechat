import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast, JOB_LABELS } from "@/lib/staff/roles";
import SurveyorLinks from "@/app/components/staff/SurveyorLinks";
import { issuedLinks } from "@/lib/staff/surveyor";

// The console you open when a surveyor is coming.
//
// The three things that decide whether an inspection goes well were on
// three different screens: who is out of date (Team), the binder export
// (an API route with no page), and the read-only link (Inspection). This
// is one screen because the question is one question.
//
// THE MATRIX IS THE POINT. A per-person shelf answers "what does Rosa
// hold"; nobody is ever asked that. The question is "is anybody short of
// anything", which is a grid — people down, credentials across, and the
// colour of the cell is the whole answer. Reading a matrix takes about a
// second; reading eleven profile pages takes a morning, which is why it
// never happens until the week of.

export const dynamic = "force-dynamic";

interface Cell {
  user_id: string;
  staff_name: string | null;
  legal_name: string | null;
  job_role: string;
  kind: string;
  kind_label: string;
  required: boolean;
  sort_order: number;
  expires_on: string | null;
  days_left: number | null;
  status: "current" | "expiring" | "expired" | "missing" | "undated";
}

const STATUS_LABEL: Record<Cell["status"], string> = {
  current: "Current",
  expiring: "Expiring",
  expired: "EXPIRED",
  missing: "Not on file",
  undated: "No date",
};

export default async function Accreditation() {
  const { session, org } = await requireStaff();
  if (!atLeast(session.role, "org_admin")) redirect("/staff");

  const { cells, links } = await withSession(session, async (sql) => ({
    cells: await sql<Cell[]>`
      select user_id, staff_name, legal_name, job_role, kind, kind_label,
             required, sort_order, expires_on::text as expires_on,
             days_left, status
        from staff.credential_matrix
       where org_slug = ${org}
       order by staff_name nulls last, sort_order
    `,
    // The same loader /staff/surveyor uses. Hand-rolling a second query
    // here produced a row shape SurveyorLinks could not render — and
    // worse, one that would drift from the real one on the next change.
    links: await issuedLinks(sql),
  }));

  // Columns are whatever credentials this clinic's jobs actually require,
  // in the order the requirements declare — not a fixed BLS/ACLS/PALS
  // list, because a med spa has neither and a dental practice needs
  // neither.
  const columns = [...new Map(
    cells.map((c) => [c.kind, { kind: c.kind, label: c.kind_label, sort: c.sort_order }])
  ).values()].sort((a, b) => a.sort - b.sort);

  const people = [...new Map(
    cells.map((c) => [c.user_id, { id: c.user_id, name: c.staff_name ?? c.legal_name ?? "—", job: c.job_role }])
  ).values()];

  const at = (uid: string, kind: string) =>
    cells.find((c) => c.user_id === uid && c.kind === kind);

  const gaps = cells.filter(
    (c) => c.required && (c.status === "expired" || c.status === "missing")
  ).length;
  const soon = cells.filter((c) => c.required && c.status === "expiring").length;

  return (
    <div className="st-page st-page-wide">
      <header className="st-page-head">
        <h1 className="st-h1">Accreditation</h1>
        <p className="st-page-sub">
          Who is short of what, the binder, and the inspector&rsquo;s link
          &mdash; the three things an inspection turns on.
        </p>
      </header>

      {(gaps > 0 || soon > 0) && (
        <div className={`st-notice${gaps > 0 ? " st-notice-warn" : ""}`} role="status">
          <strong>
            {gaps > 0
              ? `${gaps} required credential${gaps === 1 ? "" : "s"} expired or not on file`
              : `${soon} required credential${soon === 1 ? "" : "s"} expiring within 90 days`}
          </strong>
          <span>
            {gaps > 0
              ? "A missing card is written up the same as an expired one. Both are below."
              : "Long enough to book a class, if it is booked now."}
          </span>
        </div>
      )}

      <div className="st-acc-grid">
        <section className="st-panel">
          <h2 className="st-h2">Credentialing matrix</h2>
          {people.length === 0 ? (
            <p className="st-empty">
              Nobody has a job assigned yet, so there is nothing to require.
            </p>
          ) : (
            <div className="st-matrix-wrap">
              <table className="st-matrix">
                <thead>
                  <tr>
                    <th className="st-matrix-name">Staff</th>
                    <th>Job</th>
                    {columns.map((c) => (
                      <th key={c.kind}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td className="st-matrix-name">{p.name}</td>
                      <td className="st-matrix-job">
                        {JOB_LABELS[p.job] ?? p.job}
                      </td>
                      {columns.map((col) => {
                        const cell = at(p.id, col.kind);
                        if (!cell) return <td key={col.kind} className="st-cell st-cell-na">—</td>;
                        return (
                          <td
                            key={col.kind}
                            className={`st-cell st-cell-${cell.status}${
                              cell.required ? "" : " st-cell-optional"
                            }`}
                            title={
                              cell.expires_on
                                ? `${STATUS_LABEL[cell.status]} — expires ${cell.expires_on}`
                                : STATUS_LABEL[cell.status]
                            }
                          >
                            <span className="st-cell-state">{STATUS_LABEL[cell.status]}</span>
                            {cell.days_left !== null && cell.status !== "current" && (
                              <span className="st-cell-days">
                                {cell.days_left < 0
                                  ? `${Math.abs(cell.days_left)}d ago`
                                  : `${cell.days_left}d`}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="st-matrix-key">
            A faded cell is a credential this job does not require. Status is
            carried by the word, not the colour alone.
          </p>
        </section>

        <div className="st-acc-side">
          <section className="st-panel">
            <h2 className="st-h2">Evidence binder</h2>
            <p className="st-panel-sub">
              Ninety days of logs, the signed policy packet, the credential
              register and the temperature curve, as one bookmarked PDF.
            </p>
            <a className="st-primary st-block" href="/api/staff/accreditation?days=90">
              Export the binder (PDF)
            </a>
            <p className="st-fine">
              Formatted for an accreditation review. It carries no patient
              information and nothing financial.
            </p>
          </section>

          <section className="st-panel">
            <h2 className="st-h2">Surveyor access</h2>
            <p className="st-panel-sub">
              A read-only link on a clock. No login, no way into the app, and
              you can revoke it mid-visit.
            </p>
            <SurveyorLinks links={links} />
          </section>
        </div>
      </div>
    </div>
  );
}

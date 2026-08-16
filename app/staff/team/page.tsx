import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { teamStatus } from "@/lib/staff/compliance";
import { atLeast, ROLE_LABELS } from "@/lib/staff/roles";
import { formatSignedAt } from "@/lib/staff/labels";

// Who has completed their packet and who hasn't.
//
// Sorted by outstanding count, descending — the people with gaps are at
// the top, because that is the only reason to open this page. A roster
// sorted alphabetically makes you hunt for the thing you came for.

export const dynamic = "force-dynamic";

export default async function Team() {
  const { session } = await requireStaff();

  // The nav already hides this link below org_admin, but hiding a link is
  // not access control — someone who types the URL gets the same answer.
  if (!atLeast(session.role, "org_admin")) redirect("/staff");

  const team = await withSession(session, (sql) => teamStatus(sql));
  const behind = team.filter((m) => m.outstanding_count > 0).length;

  return (
    <div className="st-page">
      <header className="st-page-head">
        <h1 className="st-h1">Team</h1>
        <p className="st-page-sub">
          {team.length} active {team.length === 1 ? "person" : "people"}
          {behind > 0 ? ` · ${behind} with outstanding documents` : " · all current"}
        </p>
      </header>

      <div className="st-table-wrap">
        <table className="st-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th className="st-num">Signed</th>
              <th>Status</th>
              <th>Last signature</th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => {
              const signedCount = m.assigned_count - m.outstanding_count;
              return (
                <tr key={m.user_id}>
                  <td>
                    <span className="st-cell-name">
                      {m.legal_name ?? m.name ?? m.email}
                    </span>
                    <span className="st-cell-sub">
                      {m.job_title ? `${m.job_title} · ` : ""}
                      {m.email}
                    </span>
                  </td>
                  <td>{ROLE_LABELS[m.role]}</td>
                  <td className="st-num">
                    {signedCount}/{m.assigned_count}
                  </td>
                  <td>
                    {!m.esign_consented_at ? (
                      <span className="st-pill st-pill-new">Not started</span>
                    ) : m.outstanding_count > 0 ? (
                      <span className="st-pill st-pill-due">
                        {m.outstanding_count} outstanding
                      </span>
                    ) : (
                      <span className="st-pill st-pill-ok">Current</span>
                    )}
                  </td>
                  <td className="st-cell-when">{formatSignedAt(m.last_signed_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="st-foot">
        &ldquo;Signed&rdquo; counts documents published to this organization that
        apply to that person&rsquo;s role. Draft documents are not counted and
        cannot be signed &mdash; publish one and it appears in everyone&rsquo;s
        outstanding list immediately.
      </p>
    </div>
  );
}

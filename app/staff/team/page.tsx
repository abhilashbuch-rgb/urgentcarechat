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

const NOTICES: Record<string, string> = {
  deactivated: "Access switched off. Their live sessions stopped working immediately.",
  activated: "Access switched back on. They will need to sign in again.",
  mfa_reset: "Second factor cleared. They will set up a new one at next sign-in.",
  sessions_revoked: "Signed out of every device.",
  not_yourself: "You can't deactivate your own account from here.",
  last_admin: "That would leave this organization with no active administrator.",
  not_found: "No such person in this organization.",
  server_error: "That didn't go through. Nothing changed.",
};

export default async function Team({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; e?: string }>;
}) {
  const { session } = await requireStaff();
  const { done, e } = await searchParams;

  // The nav already hides this link below org_admin, but hiding a link is
  // not access control — someone who types the URL gets the same answer.
  if (!atLeast(session.role, "org_admin")) redirect("/staff");

  const team = await withSession(session, (sql) => teamStatus(sql));
  const active = team.filter((m) => m.active);
  const behind = active.filter((m) => m.outstanding_count > 0).length;
  const mfaGaps = active.filter((m) => m.mfa_required && !m.mfa_enrolled).length;

  return (
    <div className="st-page">
      <header className="st-page-head">
        <h1 className="st-h1">Team</h1>
        <p className="st-page-sub">
          {active.length} active {active.length === 1 ? "person" : "people"}
          {behind > 0 ? ` · ${behind} with outstanding documents` : " · all current"}
          {mfaGaps > 0 && ` · ${mfaGaps} without a second factor`}
        </p>
      </header>

      {(done || e) && (
        <div
          className={`st-notice${e ? " st-notice-warn" : ""}`}
          role={e ? "alert" : "status"}
        >
          <strong>{e ? "Not done" : "Done"}</strong>
          <span>{NOTICES[(e ?? done)!] ?? "Updated."}</span>
        </div>
      )}

      <div className="st-table-wrap">
        <table className="st-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th className="st-num">Signed</th>
              <th>Status</th>
              <th>2FA</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => {
              const signedCount = m.assigned_count - m.outstanding_count;
              return (
                <tr key={m.user_id} className={m.active ? "" : "st-row-off"}>
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
                    {/* Only when there is one. A bare em-dash under a
                        status pill reads as a broken value. */}
                    {m.last_signed_at && (
                      <span className="st-cell-sub">
                        {formatSignedAt(m.last_signed_at)}
                      </span>
                    )}
                  </td>

                  <td>
                    {m.mfa_enrolled ? (
                      <span className="st-pill st-pill-ok">On</span>
                    ) : m.mfa_required ? (
                      <span className="st-pill st-pill-due">Required</span>
                    ) : (
                      <span className="st-pill st-pill-new">Off</span>
                    )}
                  </td>

                  {/* Plain forms. Each is one POST that navigates, so
                      there is never a button that looks like it worked
                      when it didn't. */}
                  <td className="st-cell-actions">
                    {m.active ? (
                      <>
                        {/* Not offered for yourself. The API refuses it
                            too — this just means nobody is invited to
                            click the button that locks them out. */}
                        {m.user_id !== session.uid && (
                          <form method="POST" action="/api/staff/team/user">
                            <input type="hidden" name="user_id" value={m.user_id} />
                            <input type="hidden" name="action" value="deactivate" />
                            <button className="st-danger" type="submit">
                              Deactivate
                            </button>
                          </form>
                        )}
                        {m.mfa_enrolled && (
                          <form method="POST" action="/api/staff/team/user">
                            <input type="hidden" name="user_id" value={m.user_id} />
                            <input type="hidden" name="action" value="reset_mfa" />
                            <button className="st-quiet" type="submit">
                              Reset 2FA
                            </button>
                          </form>
                        )}
                        <form method="POST" action="/api/staff/team/user">
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <input type="hidden" name="action" value="revoke_sessions" />
                          <button className="st-quiet" type="submit">
                            Sign out
                          </button>
                        </form>
                      </>
                    ) : (
                      <form method="POST" action="/api/staff/team/user">
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <input type="hidden" name="action" value="activate" />
                        <button className="st-quiet" type="submit">
                          Reactivate
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="st-foot">
        Deactivating someone takes effect on their very next request, not at
        their next sign-in &mdash; the session already open on their phone
        stops working. Reactivating does not restore it; they sign in again.
        Every action here is written to the audit log with your name on it.
      </p>
    </div>
  );
}

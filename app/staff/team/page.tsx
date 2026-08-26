import { redirect } from "next/navigation";
import Link from "next/link";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { teamStatus } from "@/lib/staff/compliance";
import { atLeast, ROLE_LABELS, JOB_LABELS } from "@/lib/staff/roles";
import { pending, INVITE_TTL_HOURS } from "@/lib/staff/invites";
import { seatUsage, unassignedCount, seatBill, money, type SeatRow } from "@/lib/staff/seats";
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
  owner_only_role: "Only the owner can make someone an administrator.",
  not_permitted: "Only the owner can manage another administrator's account.",
  invited: "Invitation sent. The link works once and expires in 72 hours.",
  linked:
    "Added. They already have an account at one of your other clinics, so this doesn't cost an extra seat, and their credentials carried over — they'll see this clinic listed next time they sign in.",
  not_same_group:
    "That address belongs to an account at a clinic outside your group, so it can't be linked here. Sent as a normal invitation instead would create a separate account — try again if that's what you want.",
  already_linked: "That person is already linked into this clinic.",
  invited_no_mail:
    "Invitation created, but this deployment has no mail provider configured, so nothing was sent. Set a mail provider key and invite again.",
  revoked: "Invitation withdrawn. That link stops working immediately.",
  already_member: "That person already has active access — no invitation needed.",
  bad_email: "That doesn't look like an email address.",
  bad_role: "Unrecognised role.",
  invite_failed: "The invitation could not be sent. Nothing was changed.",
};

/**
 * One sentence, built in TypeScript rather than assembled from JSX
 * fragments — a space between an expression and the text after it does
 * not survive, which is how "$5a month" got rendered.
 *
 * It also only claims the price is uniform when it actually is. Every
 * job is five dollars today, but a per-clinic deal can move one row, and
 * a screen that says "the same for every job" while the table says
 * otherwise is worse than one that says less.
 */
function seatPriceLine(seats: SeatRow[]): string {
  const prices = [...new Set(seats.map((s) => s.extra_seat_cents))];
  const base = "Per centre, by job. Going over never stops anyone working. ";
  if (prices.length === 1) {
    return (
      base +
      `Anyone past the allowance is ${money(prices[0])} a month — the same ` +
      "for every job, so nobody has a reason to file a nurse practitioner " +
      "as front desk."
    );
  }
  return base + "Seats past the allowance are charged at the rate beside each job.";
}

export default async function Team({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; e?: string }>;
}) {
  const { session } = await requireStaff();
  const { done, e } = await searchParams;

  // The nav already hides this link below manager, but hiding a link is
  // not access control — someone who types the URL gets the same answer.
  if (!atLeast(session.role, "manager")) redirect("/staff");
  const isOwner = atLeast(session.role, "org_admin");

  const { team, invites, seats, unassigned, bill } = await withSession(
    session,
    async (sql) => ({
      team: await teamStatus(sql),
      invites: await pending(sql, session.org ?? ""),
      seats: await seatUsage(sql),
      unassigned: await unassignedCount(sql),
      bill: await seatBill(sql),
    })
  );
  const active = team.filter((m) => m.active);
  const behind = active.filter((m) => m.outstanding_count > 0).length;
  const mfaGaps = active.filter((m) => m.mfa_required && !m.mfa_enrolled).length;

  return (
    <div className="st-page">
      <header className="st-page-head st-page-head-row">
        <div>
          <h1 className="st-h1">Team</h1>
          <p className="st-page-sub">
            {active.length} active {active.length === 1 ? "person" : "people"}
            {behind > 0 ? ` · ${behind} with outstanding documents` : " · all current"}
            {mfaGaps > 0 && ` · ${mfaGaps} without a second factor`}
          </p>
        </div>
        {/* One obvious way in, from the top of the screen — not a form
            you have to already know is further down the page to find.
            Jumps to the same invite form rather than duplicating it, so
            there is still exactly one place that sends an invitation. */}
        <a className="st-add-employee" href="#invite">
          <span aria-hidden="true">+</span> Add employee
        </a>
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

      {/* WHO MAY COME IN AT ALL.
          Above the roster, because the roster answers "how are my people
          doing" and this answers "who are my people" — and on a Monday
          morning with three new hires, the second question is the one
          that brought the administrator here.

          NO SHARED CODE ANYWHERE ON THIS SCREEN. One link, minted for one
          address, mailed to that address, dead after 72 hours or one use.
          A code passed around a clinic outlives the people who were given
          it; a link tied to a mailbox does not. */}
      {/* WHAT THE SUBSCRIPTION INCLUDES, AND WHAT IS IN IT.
          Above the invite form on purpose: the moment to know a job is
          full is before typing an address into it, not after the account
          appears. Nothing here refuses anybody — see the note above
          staff.seat_usage. A clinic that hires a sixth medical assistant
          needs her filing the fridge log on her first shift, and a
          billing dispute is not a reason to leave a gap in a compliance
          record. */}
      {seats.length > 0 && (
        <section className="st-seats">
          <h2 className="st-h2">What your plan includes</h2>
          <p className="st-page-sub">{seatPriceLine(seats)}</p>

          <ul className="st-seat-list">
            {seats.map((s: SeatRow) => {
              const full = s.included > 0 && s.in_use >= s.included;
              return (
                <li
                  className={`st-seat${s.over_by > 0 ? " st-seat-over" : full ? " st-seat-full" : ""}`}
                  key={s.job_role}
                >
                  <span className="st-seat-job">
                    {JOB_LABELS[s.job_role] ?? s.job_role}
                    {s.is_override && (
                      <em className="st-seat-deal">your agreed number</em>
                    )}
                  </span>
                  <span className="st-seat-count">
                    {s.in_use} of {s.included}
                  </span>
                  <span className="st-seat-note">
                    {s.over_by > 0
                      ? `${s.over_by} over · ${money(s.extra_cents)}`
                      : s.invited_not_yet_in > 0
                        ? `${s.invited_not_yet_in} invited, not in yet`
                        : full
                          ? "full"
                          : ""}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* The one number an owner asks for, multiplied out. An
              overage nobody has done the arithmetic on is an overage
              nobody argues with until the card is charged. */}
          {bill.extra_seats > 0 && (
            <p className="st-seat-total">
              <strong>
                {bill.extra_seats} extra{" "}
                {bill.extra_seats === 1 ? "seat" : "seats"} &mdash;{" "}
                {money(bill.extra_cents)} a month
              </strong>{" "}
              on top of the plan. Deactivate anyone who has left and it
              comes off the next invoice.
            </p>
          )}

          {unassigned > 0 && (
            <p className="st-field-hint">
              {unassigned === 1
                ? "One person has no job set yet, so they count against nothing and see almost nothing on their board."
                : `${unassigned} people have no job set yet, so they count against nothing and see almost nothing on their board.`}{" "}
              Set it in the table below.
            </p>
          )}
        </section>
      )}

      <section className="st-invite" id="invite">
        <h2 className="st-h2">Invite someone</h2>
        <p className="st-page-sub">
          They get a link at this address that works once and expires in{" "}
          {INVITE_TTL_HOURS} hours. Opening it doesn&rsquo;t sign them in on
          its own &mdash; they still prove the address is theirs, so a
          forwarded link is not access.
        </p>
        <p className="st-page-sub">
          Already staff at one of your other clinics? Enter their same
          address here &mdash; it&rsquo;s linked automatically, at no extra
          seat, with no invitation to click.
        </p>

        <form className="st-invite-form" method="POST" action="/api/staff/team/invite">
          <input type="hidden" name="action" value="invite" />

          <label className="st-field st-invite-email">
            <span className="st-field-label">Work email</span>
            <input
              className="st-input"
              type="email"
              name="email"
              required
              placeholder="them@yourclinic.com"
              autoComplete="off"
            />
          </label>

          <label className="st-field">
            <span className="st-field-label">Job</span>
            <select className="st-input" name="job_role" defaultValue="medical_assistant">
              {Object.entries(JOB_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>

          {/* THE ADMINISTRATOR PICKS THIS, NOT THE INVITEE. A new hire
              choosing their own permissions on their first morning is
              the one moment nobody is watching.

              THREE LEVELS, NOT TWO. Staff does clinical work. A manager
              runs the team &mdash; same Team page, same roster, same
              register, same audit trail as the owner &mdash; but cannot
              touch billing or subscriptions, and cannot create another
              administrator. Only the owner sees that third option; a
              manager sending an invite is only ever offered staff or
              another manager, both here and on the server that receives
              this form. */}
          <label className="st-field">
            <span className="st-field-label">Access level</span>
            <select className="st-input" name="role" defaultValue="staff">
              <option value="staff">Staff &mdash; clinical work only</option>
              <option value="manager">
                Manager &mdash; runs the team, not billing
              </option>
              {isOwner && (
                <option value="org_admin">
                  Administrator &mdash; full access, including billing
                </option>
              )}
            </select>
          </label>

          <button className="st-primary st-invite-go" type="submit">
            Send invitation
          </button>
        </form>

        {invites.length > 0 && (
          <div className="st-invite-pending">
            <h3 className="st-h2">
              Waiting to be accepted ({invites.length})
            </h3>
            <table className="st-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Job</th>
                  <th>Expires</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.email}
                      {i.role === "org_admin" && (
                        <span className="st-flag-admin">Administrator</span>
                      )}
                      {i.role === "manager" && (
                        <span className="st-flag-admin">Manager</span>
                      )}
                    </td>
                    <td>{i.job_role ? JOB_LABELS[i.job_role] ?? i.job_role : "\u2014"}</td>
                    <td>
                      {/* Expired is shown rather than hidden. An
                          administrator wondering why somebody never
                          arrived needs to see the reason, and the fix
                          is the same button either way. */}
                      {i.expired ? (
                        <span className="st-pill st-pill-due">Expired</span>
                      ) : (
                        formatSignedAt(i.expires_at)
                      )}
                    </td>
                    <td>
                      <form method="POST" action="/api/staff/team/invite">
                        <input type="hidden" name="action" value="revoke" />
                        <input type="hidden" name="invite_id" value={i.id} />
                        <button className="st-quiet" type="submit">
                          {i.expired ? "Remove" : "Withdraw"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="st-table-wrap">
        <table className="st-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th className="st-num">Signed</th>
              <th>Status</th>
              <th>2FA</th>
              <th>Last sign-in</th>
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
                    {m.is_linked && (
                      <span
                        className="st-flag-linked"
                        title="Home clinic is one of your other locations — not counted in this clinic's seats."
                      >
                        Linked
                      </span>
                    )}
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

                  <td>
                    <Link className="st-cell-link" href={`/staff/team/${m.user_id}`}>
                      {m.last_seen_at ? formatSignedAt(m.last_seen_at) : "Never"}
                    </Link>
                  </td>

                  {/* Plain forms. Each is one POST that navigates, so
                      there is never a button that looks like it worked
                      when it didn't. NO BUTTON A MANAGER CANNOT USE: the
                      API already refuses a manager acting on an owner's
                      account (see api/staff/team/user/route.ts), and a
                      row of buttons that all fail the same way teaches
                      nothing except to stop trying. */}
                  <td className="st-cell-actions">
                    {!isOwner && (m.role === "org_admin" || m.role === "platform_super_admin") ? (
                      <span className="st-cell-sub">Owner-managed</span>
                    ) : m.active ? (
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
        Deactivating someone at their <strong>home</strong> clinic also
        deactivates them everywhere else they&rsquo;re linked; deactivating
        a &ldquo;Linked&rdquo; row here only ends their access to this one.
      </p>
    </div>
  );
}

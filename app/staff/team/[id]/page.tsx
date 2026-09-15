import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { teamStatus } from "@/lib/staff/compliance";
import { signinHistory } from "@/lib/staff/signins";
import { atLeast, ROLE_LABELS } from "@/lib/staff/roles";
import { profileGaps } from "@/lib/staff/profile-complete";
import { WEEKDAY_CHIPS } from "@/lib/staff/labels";
import SigninHistory from "@/app/components/staff/SigninHistory";

// One team member, from the administrator's side — currently just their
// sign-in history, the one thing the Team table can't show a whole
// column of without becoming unreadable. Reuses teamStatus() rather than
// a new by-id query: a clinic's roster is small, and this is one extra
// row scan, not a new table to keep in sync with staff.users.

export const dynamic = "force-dynamic";

export default async function TeamMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { id } = await params;
  const { done } = await searchParams;
  const { session, org } = await requireStaff();

  if (!atLeast(session.role, "manager")) redirect("/staff");

  const { member, signins, timezone, gaps } = await withSession(session, async (sql) => {
    const team = await teamStatus(sql);
    const member = team.find((m) => m.user_id === id) ?? null;
    if (!member) return { member: null, signins: [], timezone: undefined, gaps: [] };
    const [orgRow] = await sql<{ timezone: string }[]>`
      select timezone from staff.orgs where slug = ${org}
    `;
    const allGaps = await profileGaps(sql, org);
    return {
      member,
      signins: await signinHistory(sql, org, id),
      timezone: orgRow?.timezone,
      gaps: allGaps.get(id) ?? [],
    };
  });

  // Not found in this org — a mistyped id or someone else's user_id.
  // Same as any other admin lookup that comes up empty: back to the
  // list rather than a bare 404 for a screen with no direct URL entry.
  if (!member) redirect("/staff/team?e=not_found");

  // A manager can look, same as the roster row this links from, but the
  // API refuses a manager writing to an owner's account — see the note
  // on the Team list page. The toggle below is hidden rather than left
  // to fail silently, since this page has nowhere to show that error.
  const canManage =
    atLeast(session.role, "org_admin") ||
    (member.role !== "org_admin" && member.role !== "platform_super_admin");

  return (
    <div className="st-page">
      <header className="st-page-head">
        <p className="st-page-sub" style={{ marginBottom: 6 }}>
          <Link href="/staff/team">&larr; Team</Link>
        </p>
        <h1 className="st-h1">{member.legal_name ?? member.name ?? member.email}</h1>
        <p className="st-page-sub">
          {member.email} &middot; {ROLE_LABELS[member.role]}
          {member.job_title ? ` · ${member.job_title}` : ""}
          {!member.active && " · Deactivated"}
        </p>
      </header>

      {done === "digest_updated" && (
        <div className="st-notice" role="status">
          <strong>Updated.</strong>
          <span>Their email preference now takes effect on the next digest.</span>
        </div>
      )}

      {done === "workdays_updated" && (
        <div className="st-notice" role="status">
          <strong>Updated.</strong>
          <span>Their schedule now shows on the Today page&rsquo;s on-duty list.</span>
        </div>
      )}

      {done === "huddle_updated" && (
        <div className="st-notice" role="status">
          <strong>Updated.</strong>
          <span>Their morning-huddle preference now takes effect on the next send.</span>
        </div>
      )}

      <section className="st-record-section">
        <h2 className="st-h2">Profile complete?</h2>
        <p className="st-page-sub" style={{ marginBottom: 12 }}>
          Everything the app knows to check for this person, in one
          place — required credentials, their work schedule, e-sign
          consent, and whether anything has actually been uploaded to
          their document shelf.
        </p>
        {gaps.length === 0 ? (
          <p className="st-page-sub">
            <span className="st-pill st-pill-ok">Complete</span> Nothing
            outstanding right now.
          </p>
        ) : (
          <ul className="st-gap-list">
            {gaps.map((g) => (
              <li key={g.label} className="st-gap-row">
                {g.label}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="st-record-section">
        <h2 className="st-h2">Email preferences</h2>
        <p className="st-page-sub" style={{ marginBottom: 12 }}>
          The only thing to toggle here is the routine digest &mdash; what
          got done, what did not. Urgent alerts (an out-of-range reading, a
          missed task) go to every active person regardless; there is no
          switch for those, for anyone, including from here.
        </p>
        {canManage ? (
          <form method="POST" action="/api/staff/team/user">
            <input type="hidden" name="user_id" value={id} />
            <input type="hidden" name="action" value="toggle_digest" />
            <input type="hidden" name="wants" value={member.wants_digest ? "0" : "1"} />
            <button className="st-btn" type="submit">
              {member.wants_digest ? "Turn off digest emails" : "Turn on digest emails"}
            </button>
          </form>
        ) : (
          <p className="st-page-sub">Set by the owner.</p>
        )}
      </section>

      <section className="st-record-section">
        <h2 className="st-h2">Morning huddle</h2>
        <p className="st-page-sub" style={{ marginBottom: 12 }}>
          A good-morning email at the start of their shift — their agenda
          for the day, any notes from the center admin, and a quote. On
          by default for every day their schedule below says they work;
          turning it off here just means this one person stops getting
          it, on any day.
        </p>
        {canManage ? (
          <form method="POST" action="/api/staff/team/user">
            <input type="hidden" name="user_id" value={id} />
            <input type="hidden" name="action" value="toggle_huddle" />
            <input
              type="hidden"
              name="wants"
              value={member.wants_morning_huddle ? "0" : "1"}
            />
            <button className="st-btn" type="submit">
              {member.wants_morning_huddle
                ? "Turn off the morning huddle"
                : "Turn on the morning huddle"}
            </button>
          </form>
        ) : (
          <p className="st-page-sub">Set by the owner.</p>
        )}
      </section>

      <section className="st-record-section">
        <h2 className="st-h2">Schedule</h2>
        <p className="st-page-sub" style={{ marginBottom: 12 }}>
          Which days this person normally works &mdash; not a clock, just
          a schedule. It drives the &ldquo;On duty today&rdquo; list on
          the Today page and who gets the morning huddle above, so a
          shift can see at a glance who today&rsquo;s medical assistant
          or center admin is expected to be. Leave it blank if this
          person&rsquo;s days vary too much to say.
        </p>
        {canManage ? (
          <form method="POST" action="/api/staff/team/user">
            <input type="hidden" name="user_id" value={id} />
            <input type="hidden" name="action" value="set_workdays" />
            <div className="st-workday-picker" role="group" aria-label="Workdays">
              {WEEKDAY_CHIPS.map((d) => (
                <label key={d.value} className="st-workday-chip">
                  <input
                    type="checkbox"
                    name="weekday"
                    value={d.value}
                    defaultChecked={member.workdays.includes(d.value)}
                  />
                  {d.label}
                </label>
              ))}
            </div>
            <button className="st-btn" type="submit" style={{ marginTop: 12 }}>
              Save schedule
            </button>
          </form>
        ) : (
          <p className="st-page-sub">Set by the owner.</p>
        )}
      </section>

      <section className="st-record-section">
        <h2 className="st-h2">Sign-in history</h2>
        <p className="st-page-sub" style={{ marginBottom: 12 }}>
          Every time this person has signed in, most recent first. They can
          see this same list on their own record.
        </p>
        <SigninHistory events={signins} timezone={timezone} />
      </section>
    </div>
  );
}

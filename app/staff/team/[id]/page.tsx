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
import Avatar from "@/app/components/staff/Avatar";

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

  const { member, signins, timezone, gaps, theme } = await withSession(session, async (sql) => {
    const team = await teamStatus(sql);
    const member = team.find((m) => m.user_id === id) ?? null;
    const theme = (
      await sql<{ brand_color: string; logo_url: string | null }[]>`
        select brand_color, logo_url from staff.org_theme where slug = ${org}
      `
    )[0] ?? { brand_color: "#173a8a", logo_url: null };
    if (!member) return { member: null, signins: [], timezone: undefined, gaps: [], theme };
    const [orgRow] = await sql<{ timezone: string }[]>`
      select timezone from staff.orgs where slug = ${org}
    `;
    const allGaps = await profileGaps(sql, org);
    return {
      member,
      signins: await signinHistory(sql, org, id),
      timezone: orgRow?.timezone,
      gaps: allGaps.get(id) ?? [],
      theme,
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
        <p className="st-page-sub" style={{ marginBottom: 12 }}>
          <Link href="/staff/team">&larr; Team</Link>
        </p>
        <div className="st-profile-head">
          <Avatar
            name={member.legal_name ?? member.name ?? member.email}
            src={member.avatar_path ? `/api/staff/avatar/view?u=${member.user_id}` : null}
            brandColor={theme.brand_color}
            badgeUrl={theme.logo_url}
            size={64}
          />
          <div className="st-profile-identity">
            <h1 className="st-h1">{member.legal_name ?? member.name ?? member.email}</h1>
            <p className="st-page-sub">
              {member.email} &middot; {ROLE_LABELS[member.role]}
              {member.job_title ? ` · ${member.job_title}` : ""}
            </p>
            <div className="st-profile-badges">
              <span className={`st-pill ${member.active ? "st-pill-ok" : "st-pill-due"}`}>
                {member.active ? "Active" : "Deactivated"}
              </span>
              <span className={`st-pill ${member.mfa_enrolled ? "st-pill-ok" : member.mfa_required ? "st-pill-due" : "st-pill-new"}`}>
                2FA {member.mfa_enrolled ? "on" : member.mfa_required ? "required" : "off"}
              </span>
              <span className={`st-pill ${member.phone_verified_at ? "st-pill-ok" : "st-pill-new"}`}>
                {member.phone_verified_at ? "Phone verified" : member.phone ? "Phone unverified" : "No phone"}
              </span>
            </div>
          </div>
        </div>
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

      {done === "preferred_name_updated" && (
        <div className="st-notice" role="status">
          <strong>Updated.</strong>
          <span>Shows on the on-duty banner from now on.</span>
        </div>
      )}

      <section className="st-record-section">
        <h2 className="st-h2">Goes by</h2>
        <p className="st-page-sub" style={{ marginBottom: 12 }}>
          Their name on file is <strong>{member.legal_name ?? member.name ?? member.email}</strong>
          &nbsp;&mdash; that never changes here, it&rsquo;s what they
          actually sign documents as. If the floor knows them by a
          different name, put it here and the &ldquo;on duty
          today&rdquo; banner uses it instead. Leave it blank to just
          use the name on file.
        </p>
        {canManage ? (
          <form method="POST" action="/api/staff/team/user">
            <input type="hidden" name="user_id" value={id} />
            <input type="hidden" name="action" value="set_preferred_name" />
            <input
              className="st-input"
              type="text"
              name="preferred_name"
              defaultValue={member.preferred_name ?? ""}
              placeholder={member.legal_name ?? member.name ?? ""}
              style={{ maxWidth: 260 }}
            />
            <button className="st-btn" type="submit" style={{ marginTop: 12 }}>
              Save
            </button>
          </form>
        ) : (
          <p className="st-page-sub">Set by the owner.</p>
        )}
      </section>

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
        <h2 className="st-h2">Schedule</h2>
        <p className="st-page-sub" style={{ marginBottom: 12 }}>
          Which days this person normally works &mdash; not a clock, just
          a schedule. It drives the &ldquo;On duty today&rdquo; list on
          the Today page and the morning-huddle email (their agenda,
          center-admin notes, and a quote, every day they&rsquo;re
          scheduled &mdash; no opt-out, same as an urgent alert has
          none), so a shift can see at a glance who today&rsquo;s
          medical assistant or center admin is expected to be. Leave it
          blank if this person&rsquo;s days vary too much to say.
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

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { teamStatus } from "@/lib/staff/compliance";
import { signinHistory } from "@/lib/staff/signins";
import { atLeast, ROLE_LABELS } from "@/lib/staff/roles";
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

  if (!atLeast(session.role, "org_admin")) redirect("/staff");

  const { member, signins, timezone } = await withSession(session, async (sql) => {
    const team = await teamStatus(sql);
    const member = team.find((m) => m.user_id === id) ?? null;
    if (!member) return { member: null, signins: [], timezone: undefined };
    const [orgRow] = await sql<{ timezone: string }[]>`
      select timezone from staff.orgs where slug = ${org}
    `;
    return {
      member,
      signins: await signinHistory(sql, org, id),
      timezone: orgRow?.timezone,
    };
  });

  // Not found in this org — a mistyped id or someone else's user_id.
  // Same as any other admin lookup that comes up empty: back to the
  // list rather than a bare 404 for a screen with no direct URL entry.
  if (!member) redirect("/staff/team?e=not_found");

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

      <section className="st-record-section">
        <h2 className="st-h2">Email preferences</h2>
        <p className="st-page-sub" style={{ marginBottom: 12 }}>
          The only thing to toggle here is the routine digest &mdash; what
          got done, what did not. Urgent alerts (an out-of-range reading, a
          missed task) go to every active person regardless; there is no
          switch for those, for anyone, including from here.
        </p>
        <form method="POST" action="/api/staff/team/user">
          <input type="hidden" name="user_id" value={id} />
          <input type="hidden" name="action" value="toggle_digest" />
          <input type="hidden" name="wants" value={member.wants_digest ? "0" : "1"} />
          <button className="st-btn" type="submit">
            {member.wants_digest ? "Turn off digest emails" : "Turn on digest emails"}
          </button>
        </form>
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

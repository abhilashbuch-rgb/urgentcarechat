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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, org } = await requireStaff();

  if (!atLeast(session.role, "org_admin")) redirect("/staff");

  const { member, signins } = await withSession(session, async (sql) => {
    const team = await teamStatus(sql);
    const member = team.find((m) => m.user_id === id) ?? null;
    if (!member) return { member: null, signins: [] };
    return { member, signins: await signinHistory(sql, org, id) };
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

      <section className="st-record-section">
        <h2 className="st-h2">Sign-in history</h2>
        <p className="st-page-sub" style={{ marginBottom: 12 }}>
          Every time this person has signed in, most recent first. They can
          see this same list on their own record.
        </p>
        <SigninHistory events={signins} />
      </section>
    </div>
  );
}

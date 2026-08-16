import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { navFor, ROLE_LABELS } from "@/lib/staff/roles";

// The staff landing screen.
//
// Phase 0 has no compliance forms yet, so rather than mock them this
// shows what is genuinely working: the session, the org it resolved to,
// and a count read back through row-level security. If the org context
// weren't being set, that count would come back as zero rather than as
// somebody else's number — which is the behaviour worth being able to see.

export const dynamic = "force-dynamic";

interface Overview {
  orgName: string;
  teamCount: number;
}

export default async function StaffHome() {
  const { session, org } = await requireStaff();

  let overview: Overview | null = null;
  let dbError: string | null = null;

  try {
    overview = await withSession(session, async (sql) => {
      const orgs = await sql<{ name: string }[]>`
        select name from staff.orgs where slug = ${org}
      `;
      const users = await sql<{ count: string }[]>`
        select count(*)::text as count from staff.users where active
      `;
      return {
        orgName: orgs[0]?.name ?? org,
        teamCount: Number(users[0]?.count ?? 0),
      };
    });
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown error";
  }

  const upcoming = navFor(session.role).filter((item) => item.placeholder);

  return (
    <div className="st-page">
      <header className="st-page-head">
        {/* "Today", not the org name — the header above already says which
            clinic this is, and repeating it here gave the screen two
            headings that said the same thing. Matching the nav item means
            the page title and the tab you clicked agree. */}
        <h1 className="st-h1">Today</h1>
        <p className="st-page-sub">
          Signed in as {session.email} &middot; {ROLE_LABELS[session.role]}
        </p>
      </header>

      {dbError && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>The staff database isn&rsquo;t reachable</strong>
          <span>
            Run <code>supabase/staff-schema.sql</code>, then set{" "}
            <code>STAFF_DATABASE_URL</code> to the <code>staff_app</code> role.
            The sign-in above still worked, so the session and org resolution
            are fine &mdash; only the data layer is missing.
          </span>
          <span className="st-notice-detail">{dbError}</span>
        </div>
      )}

      <section className="st-cards">
        <article className="st-card">
          <p className="st-card-label">Organization</p>
          <p className="st-card-value">{overview?.orgName ?? org}</p>
          <p className="st-card-note">
            Resolved from this hostname, not from your session &mdash; so a
            stale cookie can never choose which clinic you&rsquo;re looking at.
          </p>
        </article>

        <article className="st-card">
          <p className="st-card-label">Your access</p>
          <p className="st-card-value">{ROLE_LABELS[session.role]}</p>
          <p className="st-card-note">
            Set by your invitation. Roles are enforced in the database, not
            just in this menu.
          </p>
        </article>

        <article className="st-card">
          <p className="st-card-label">Active team members</p>
          <p className="st-card-value">
            {overview ? overview.teamCount : "—"}
          </p>
          <p className="st-card-note">
            Read through row-level security scoped to {org}. Other
            organizations&rsquo; staff are not merely filtered out of this
            query &mdash; they are invisible to it.
          </p>
        </article>
      </section>

      {upcoming.length > 0 && (
        <section className="st-next">
          <h2 className="st-h2">Coming next</h2>
          <ul className="st-next-list">
            {upcoming.map((item) => (
              <li key={item.href}>
                <span className="st-next-name">{item.label}</span>
                <span className="st-next-note">{item.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="st-foot">
        This area is separate from the patient symptom checker, which stays
        anonymous: no accounts, no records, nothing here connected to it.
      </p>
    </div>
  );
}

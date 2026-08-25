import type { Metadata } from "next";
import { resolve } from "@/lib/staff/auth";
import { getTenantBySlug } from "@/lib/tenants";
import { groupedNavFor, ROLE_LABELS } from "@/lib/staff/roles";
import type { NavItem } from "@/lib/staff/roles";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import Avatar from "@/app/components/staff/Avatar";
import ShiftChime from "@/app/components/staff/ShiftChime";
import InstallPrompt from "@/app/components/staff/InstallPrompt";
import BrandLockup from "@/app/components/BrandLockup";

// The staff shell. Lives at /staff on an org's own hostname
// (afc.medicin.io/staff) — see the passthrough in proxy.ts, which
// keeps this path out of the /t/<slug> rewrite that serves the patient
// portal.

export const metadata: Metadata = {
  title: "Staff",
  // Internal tooling. Not a page anyone should reach from a search result.
  robots: { index: false, follow: false, nocache: true },
};

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await resolve();

  // Signed out, wrong org, or no org: render the child bare. The sign-in
  // page is its own full screen and would look absurd inside a shell
  // whose header names a user who isn't signed in.
  if (!result.ok) {
    return <div className="st">{children}</div>;
  }

  const { session, org } = result.ctx;
  const tenant = await getTenantBySlug(org);
  const orgName = tenant?.displayName ?? org;
  // Nav is filtered by ROLE and by JOB. Most providers hold the plain
  // "staff" role, so a clinical link gated on role alone would be hidden
  // from the people it exists for.
  const { me, theme, audio, openNow } = await withSession(session, async (sql) => ({
    me: await getProfile(sql, session.uid),
    audio: (
      await sql<{ audio_alerts_enabled: boolean }[]>`
        select audio_alerts_enabled from staff.users where id = ${session.uid}
      `
    )[0]?.audio_alerts_enabled ?? true,
    // Whether the clinic is open right now, in ITS timezone. Decided in
    // SQL by the same function the alert sweep uses, so the badge and the
    // sweep can never disagree about whether it is clinic hours.
    openNow: (
      await sql<{ within: boolean }[]>`
        select staff.within_operating_hours(${session.org}) as within
      `
    )[0]?.within ?? false,
    theme: (
      await sql<{ brand_color: string; logo_url: string | null }[]>`
        select brand_color, logo_url from staff.org_theme where slug = ${org}
      `
    )[0] ?? { brand_color: "#173a8a", logo_url: null },
  }));
  const { top, groups } = groupedNavFor(session.role, me?.job_role ?? null);

  // One item, link or placeholder — shared by the standalone top link
  // (Today) and every item inside a group, so the two render identically.
  const renderNavItem = (item: NavItem) =>
    item.placeholder ? (
      <span
        key={item.href}
        className="st-nav-link st-nav-soon"
        title={item.note}
        aria-disabled="true"
      >
        {item.label}
        <span className="st-soon-dot" aria-hidden="true" />
      </span>
    ) : (
      <a key={item.href} className="st-nav-link" href={item.href}>
        {item.label}
      </a>
    );

  return (
    <div className="st">
      <header className="st-top">
        <div className="st-top-inner">
          {/* THE ONE NAV, EVERY WIDTH — see the "nav: a drawer, not a
              row" comment in globals.css for why there is no wide-screen
              row version any more: the header's own max-width caps the
              space available to it regardless of how big the monitor is,
              and even five top-level entries plus Today do not fit beside
              the brand and the signed-in-as cluster at ANY size.
              <details>/<summary> needs no client component and no state:
              closed on every fresh page load, and clicking a link
              navigates away, which closes it for free — nested
              <details> for each group get that for free too, so
              "Administer" collapses again the moment you leave the page
              rather than staying pinned open from your last visit. */}
          <details className="st-nav-menu">
            <summary className="st-nav-toggle">
              <span className="st-nav-bars" aria-hidden="true">
                <span className="st-nav-bar" />
                <span className="st-nav-bar" />
                <span className="st-nav-bar" />
              </span>
              Menu
            </summary>
            <nav className="st-nav-drawer">
              {top.map(renderNavItem)}
              {groups.map((g) => (
                <details key={g.group} className="st-nav-group">
                  <summary className="st-nav-group-toggle">{g.label}</summary>
                  <div className="st-nav-group-items">
                    {g.items.map(renderNavItem)}
                  </div>
                </details>
              ))}
            </nav>
          </details>

          {/* THE SAME LOCKUP AS THE PUBLIC SITE, then the clinic's name.
              This header used to carry the mark ALONE with the clinic's
              name where the wordmark belongs — reasonable in isolation,
              and wrong in aggregate: the product looked like one brand
              on the marketing site and a different one the moment you
              signed in. The clinic's name still matters more to somebody
              at 7am than the product's does, so it stays — after the
              lockup and a divider, rather than instead of it. */}
          <a className="st-brand" href="/staff">
            <BrandLockup />
            <span className="st-brand-sep" aria-hidden="true" />
            <span className="st-brand-name">{orgName}</span>
            <span className="st-brand-tag">Staff</span>
          </a>

          <div className="st-me">
            <ShiftChime audioEnabled={audio} openNow={openNow} />
            {/* The photo is fetched through a signed-link route rather
                than being a public URL — the bucket also holds licences.
                No photo renders initials on the same ring, so the empty
                state is a state and not a broken image. */}
            <Avatar
              name={me?.legal_name ?? me?.name ?? session.email}
              src={me?.avatar_path ? `/api/staff/avatar/view?u=${session.uid}` : null}
              brandColor={theme.brand_color}
              badgeUrl={theme.logo_url}
              size={30}
            />
            <span className="st-me-email">{session.email}</span>
            <span className="st-me-role">{ROLE_LABELS[session.role]}</span>
            <form method="POST" action="/api/staff/auth/signout">
              <button className="st-signout" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="st-main">{children}</main>

      {/* Sits at the bottom of the signed-in shell, so it only ever
          reaches staff — and renders nothing at all when the app is
          already installed, when it has been dismissed, or on a browser
          where the instruction would not be true. */}
      <InstallPrompt />
    </div>
  );
}

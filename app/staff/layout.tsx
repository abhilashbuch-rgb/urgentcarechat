import type { Metadata } from "next";
import { resolve } from "@/lib/staff/auth";
import { getTenantBySlug } from "@/lib/tenants";
import { navFor, ROLE_LABELS } from "@/lib/staff/roles";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import Avatar from "@/app/components/staff/Avatar";
import ShiftChime from "@/app/components/staff/ShiftChime";
import InstallPrompt from "@/app/components/staff/InstallPrompt";
import BrandIcon from "@/app/components/BrandIcon";

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
  const { me, theme, audio } = await withSession(session, async (sql) => ({
    me: await getProfile(sql, session.uid),
    audio: (
      await sql<{ audio_alerts_enabled: boolean }[]>`
        select audio_alerts_enabled from staff.users where id = ${session.uid}
      `
    )[0]?.audio_alerts_enabled ?? true,
    theme: (
      await sql<{ brand_color: string; logo_url: string | null }[]>`
        select brand_color, logo_url from staff.org_theme where slug = ${org}
      `
    )[0] ?? { brand_color: "#173a8a", logo_url: null },
  }));
  const nav = navFor(session.role, me?.job_role ?? null);

  return (
    <div className="st">
      <header className="st-top">
        <div className="st-top-inner">
          {/* The mark, then the CLINIC's name — not the product's. Staff
              open this at 7am to run the fridge check; the name that
              matters to them is the one on the door they walked through.
              The mark is what says which product they are in. */}
          <a className="st-brand" href="/staff">
            <BrandIcon size={22} />
            <span className="st-brand-name">{orgName}</span>
            <span className="st-brand-tag">Staff</span>
          </a>

          <nav className="st-nav">
            {nav.map((item) =>
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
              )
            )}
          </nav>

          <div className="st-me">
            <ShiftChime audioEnabled={audio} />
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

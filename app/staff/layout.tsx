import type { Metadata } from "next";
import { resolve } from "@/lib/staff/auth";
import { getTenantBySlug } from "@/lib/tenants";
import { navFor, ROLE_LABELS } from "@/lib/staff/roles";

// The staff shell. Lives at /staff on an org's own hostname
// (afc.urgentcare.chat/staff) — see the passthrough in proxy.ts, which
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
  const nav = navFor(session.role);

  return (
    <div className="st">
      <header className="st-top">
        <div className="st-top-inner">
          <div className="st-brand">
            <span className="st-brand-name">{orgName}</span>
            <span className="st-brand-tag">Staff</span>
          </div>

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
    </div>
  );
}

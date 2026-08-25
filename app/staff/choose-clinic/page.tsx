import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import BrandLockup from "@/app/components/BrandLockup";
import { withOrg } from "@/lib/staff/db";
import { ORG_CHOICE_COOKIE, verifyOrgChoice } from "@/lib/staff/org-choice";

// Reached only when sign-in has proved WHO somebody is and found more
// than one clinic that person deliberately works at — see
// supabase/staff-multisite-worker.sql and the "choose" branch in both
// auth callbacks. Nobody lands here for an ordinary single-clinic
// account; a genuine email collision between two unrelated people is
// refused before this page, not sent to it.

export const dynamic = "force-dynamic";

export default async function ChooseClinic() {
  const jar = await cookies();
  const choice = await verifyOrgChoice(jar.get(ORG_CHOICE_COOKIE)?.value);
  if (!choice) redirect("/staff/signin?e=choice_expired");

  const orgs = await withOrg("", "staff", async (sql) => {
    return sql<{ org_slug: string; org_name: string }[]>`
      select org_slug, org_name
        from staff.list_my_orgs_for_person(${choice.personKey})
    `;
  });

  // The cookie proved a real match at verify time; if nothing comes back
  // now the underlying access changed in the few minutes since (a
  // deactivation, most likely). Same fix either way: sign in again.
  if (orgs.length === 0) redirect("/staff/signin?e=choice_expired");

  return (
    <div className="st-signin">
      <div className="st-signin-card">
        <div className="st-signin-brand">
          <BrandLockup tagline />
        </div>
        <h1 className="st-signin-title">Which clinic?</h1>
        <p className="st-signin-sub">
          {choice.email} works at more than one of these. Pick where
          you&rsquo;re clocking in.
        </p>

        <form className="st-choose-clinic" method="POST" action="/api/staff/auth/choose-clinic">
          {orgs.map((o) => (
            <button
              key={o.org_slug}
              className="st-choose-clinic-btn"
              type="submit"
              name="org"
              value={o.org_slug}
            >
              {o.org_name}
            </button>
          ))}
        </form>
      </div>
    </div>
  );
}

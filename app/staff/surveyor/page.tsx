import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { issuedLinks } from "@/lib/staff/surveyor";
import SurveyorLinks from "@/app/components/staff/SurveyorLinks";

// Issuing read-only access for an inspector.
//
// ADMINISTRATORS ONLY, and redirected rather than shown a refusal: a
// page explaining a capability you cannot use is a page that teaches
// people to ask for the permission. The nav link is hidden too.

export const dynamic = "force-dynamic";

export default async function SurveyorPage() {
  const { session } = await requireStaff();
  if (!atLeast(session.role, "org_admin")) redirect("/staff");

  const links = await withSession(session, (sql) => issuedLinks(sql));

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <h1 className="st-h1">Inspection access</h1>
        <p className="st-page-sub">
          One read-only link for an inspector&rsquo;s own device. It expires by
          itself, and you can close it sooner.
        </p>
      </header>

      {/* Said before the button, not after. Somebody about to hand a
          stranger the clinic's compliance record should know exactly what
          that stranger will and will not see. */}
      <div className="st-notice" role="status">
        <strong>What the inspector sees</strong>
        <span>
          Today&rsquo;s logs and who filed them, credential expiry dates, and
          open obligations. Not billing, not settings, not your team page, and
          nothing they can edit. No patient information exists anywhere in this
          product to show them.
        </span>
      </div>

      <SurveyorLinks links={links} />
    </div>
  );
}

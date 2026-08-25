import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withOrg } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { paymentLink } from "@/lib/staff/billing";
import AddClinicForm from "@/app/components/staff/AddClinicForm";
import SwitchClinicButton from "@/app/components/staff/SwitchClinicButton";

// The clinics an org_admin runs, and the door to add another.
//
// $149/clinic/month, same as the first — the landing page has always
// said this ("no volume discount... each clinic at the same price") and
// staff.add_clinic() now actually enforces it: a new clinic gets its own
// 30-day trial rather than inheriting the caller's paid status for free.

export const dynamic = "force-dynamic";

const FACILITY_LABELS: Record<string, string> = {
  urgent_care: "Urgent care",
  primary_care: "Primary care or pediatrics",
  med_spa: "Medical spa",
  ambulatory_surgery: "Surgery center",
  dental: "Dental or oral surgery",
};

interface ClinicRow {
  slug: string;
  name: string;
  facility_type: string;
  member_role: string;
  is_home: boolean;
  subscription_status: string;
  is_read_only: boolean;
  trial_ends_on: string | null;
}

export default async function ClinicsPage() {
  const { session, org } = await requireStaff();
  if (!atLeast(session.role, "org_admin")) redirect("/staff");

  const clinics = await withOrg("", "platform_super_admin", (sql) =>
    sql<ClinicRow[]>`
      select slug, name, facility_type::text as facility_type, member_role::text as member_role,
             is_home, subscription_status, is_read_only, trial_ends_on::text as trial_ends_on
        from staff.list_my_orgs(${session.uid})
       order by is_home desc, name
    `
  );

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <h1 className="st-h1">Clinics</h1>
        <p className="st-page-sub">
          One login across every clinic you run, $149/month each.
        </p>
      </header>

      <section className="st-set-block">
        <h2 className="st-set-h">Your clinics</h2>
        <ul className="st-board">
          {clinics.map((c) => {
            const current = c.slug === org;
            // Mirrors staff.org_is_read_only(): a trial's expiry is
            // computed on read, not flipped by a job, so a clinic whose
            // trial_ends_on has passed is read-only even though the raw
            // column here still says false.
            const trialExpired =
              c.subscription_status === "trialing" &&
              !!c.trial_ends_on &&
              c.trial_ends_on < new Date().toISOString().slice(0, 10);
            const needsPayment =
              c.is_read_only || trialExpired || c.subscription_status === "trialing";
            const pay = needsPayment ? paymentLink(c.slug) : null;
            return (
              <li className="st-board-row" key={c.slug}>
                <div className="st-board-main">
                  <span className="st-board-name">
                    {c.name}
                    {current && <span className="st-board-slot">current</span>}
                  </span>
                  <span className="st-board-meta">
                    {FACILITY_LABELS[c.facility_type] ?? c.facility_type} &middot;{" "}
                    {c.subscription_status === "trialing"
                      ? c.trial_ends_on
                        ? `trial ends ${c.trial_ends_on}`
                        : "trial"
                      : c.subscription_status}
                    {(c.is_read_only || trialExpired) && " · read-only until paid"}
                  </span>
                </div>
                <div className="st-board-action">
                  {!current && <SwitchClinicButton slug={c.slug} />}
                  {pay && (
                    <a className="st-board-btn" href={pay}>
                      Pay $149/month to activate
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="st-set-block">
        <h2 className="st-set-h">Add a clinic</h2>
        <p className="st-set-b">
          Same account, a second board. It starts with a 30-day trial like
          any new clinic &mdash; pay to keep it once you&rsquo;re ready,
          from the list above.
        </p>
        <AddClinicForm />
      </section>
    </div>
  );
}

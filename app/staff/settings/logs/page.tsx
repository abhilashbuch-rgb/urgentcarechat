import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { runsClinic } from "@/lib/staff/roles";

// Which logs this clinic runs.
//
// SEPARATE FROM SETTINGS, ON PURPOSE. Everything on /staff/settings is a
// decision about accountability: where the clinic is, who gets telephoned
// when a fridge fails, who receives the monthly digest. Those belong to
// whoever signed the lease.
//
// This is a different kind of question. Is there an autoclave in the back
// room? Is there a urinalysis analyzer on the counter? Those are facts
// about a building, and the person who knows them is the centre
// administrator — whose account role is very often plain "staff", because
// they do not touch billing. Putting this behind org_admin would have
// left the decision with the one person who is not in the building.

export const dynamic = "force-dynamic";

interface OptionalLog {
  slug: string;
  name: string;
  description: string | null;
  frequency: string;
  active: boolean;
}

const FREQUENCY_NOTE: Record<string, string> = {
  on_event: "Filed each time it happens, not on a schedule.",
  daily: "Due once a day.",
  weekly: "Due once a week.",
  monthly: "Due once a month.",
  quarterly: "Due once a quarter.",
  per_shift: "Due once per shift.",
};

export default async function ClinicLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; e?: string }>;
}) {
  const { session } = await requireStaff();
  const { saved, e } = await searchParams;

  const data = await withSession(session, async (sql) => ({
    profile: await getProfile(sql, session.uid),
    optional: await sql<OptionalLog[]>`
      select slug, name, description, frequency, active
        from staff.optional_logs
    `,
  }));

  // Re-checked here, not only in the nav. Hiding a link is a convenience;
  // this is the control.
  if (!runsClinic(session.role, data.profile?.job_role ?? null)) {
    redirect("/staff");
  }

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <h1 className="st-h1">Clinic logs</h1>
        <p className="st-page-sub">
          What this clinic actually has equipment for
        </p>
      </header>

      {saved && (
        <div className="st-notice" role="status">
          <strong>Saved.</strong>
          <span>
            Boards pick this up on the next page load &mdash; nobody has to
            sign out.
          </span>
        </div>
      )}
      {e && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>Not saved</strong>
          <span>Nothing was changed &mdash; try again.</span>
        </div>
      )}

      <form className="st-log" method="POST" action="/api/staff/settings/logs">
        <section className="st-set-block">
          <p className="st-set-b">
            Some equipment is not in every building. A clinic that
            autoclaves nothing should not carry a sterilization log it can
            never file &mdash; one permanent unfilled row is how a board
            stops being read, and it takes the rows that matter down with
            it. Switch on what you actually have.
          </p>
          <p className="st-set-b">
            Nothing statutory is on this list. Sharps containers, fire
            extinguishers, the exposure log and the hazardous chemical
            inventory are required of the employer whatever the clinic
            owns, so they are not shown here and cannot be switched off.
          </p>

          {data.optional.length === 0 ? (
            <p className="st-set-b">
              There are no optional logs for this clinic&rsquo;s facility
              type. Everything on the board is required.
            </p>
          ) : (
            <div className="st-set-checks">
              {data.optional.map((log) => (
                <label className="st-set-check" key={log.slug}>
                  <input
                    type="checkbox"
                    name={`log_${log.slug}`}
                    defaultChecked={log.active}
                  />
                  <span>
                    <strong>{log.name}</strong>
                    <em>
                      {log.description}
                      {FREQUENCY_NOTE[log.frequency] &&
                        ` ${FREQUENCY_NOTE[log.frequency]}`}
                    </em>
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Turning one off hides it from every board from the next page
              load. It does NOT remove what was already filed — those
              records stay in the compliance history and stay exportable,
              which is the only thing that makes switching one off a safe
              thing to try. */}
          <p className="st-field-hint">
            Turning one off hides it from today onwards. Anything already
            filed under it stays on the record and stays exportable for an
            inspection.
          </p>
        </section>

        <button className="st-primary" type="submit">
          Save
        </button>
      </form>
    </div>
  );
}

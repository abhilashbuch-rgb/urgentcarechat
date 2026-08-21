import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import AddressLookup from "@/app/components/staff/AddressLookup";

// The clinic's own settings.
//
// Everything on this page used to be writable only by hand in the SQL
// editor. A clinic that signed up got no coordinates, no alert address
// and no report subscriber — so the location stamp measured against
// nothing, an excursion at 55°F emailed nobody, and the digest had no
// recipient. The product looked like it was working and three of its
// headline features were off.
//
// GROUPED BY WHAT BREAKS IF IT IS WRONG, not by which table the column
// lives in. Somebody setting this up at 7am is answering "where are we,
// who do we tell, what do we send" — not editing staff.orgs.

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  timezone:
    "Use a Region/City name like America/New_York. An abbreviation like EST has no daylight-saving rule, so reminders drift by an hour for half the year.",
  halfcoord:
    "Fill in both latitude and longitude, or neither. Half a coordinate would place the clinic on the equator.",
  coords: "Those coordinates are out of range.",
  radius: "The radius has to be between 25 and 5000 metres.",
  mode: "Pick one of the three location settings.",
  requireneedscoords:
    "Requiring on-site filing needs the clinic's coordinates first — otherwise there is nothing to measure against and nobody could file anything.",
  owneremail: "Check the owner's alert address.",
  mdemail: "Check the medical director's alert address.",
  reportemail:
    "A scheduled report needs an address to send to.",
  save: "That didn't save. Nothing was changed — try again.",
  forbidden: "Only an administrator can change the clinic's settings.",
};

interface OrgSettings {
  name: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
  geofence_mode: string;
  owner_alert_email: string | null;
  medical_director_alert_email: string | null;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; saved?: string }>;
}) {
  const { session, org } = await requireStaff();
  if (!atLeast(session.role, "org_admin")) redirect("/staff");

  const { e, saved } = await searchParams;

  const data = await withSession(session, async (sql) => ({
    settings: (
      await sql<OrgSettings[]>`
        select name, timezone, latitude, longitude, geofence_radius_m,
               geofence_mode, owner_alert_email, medical_director_alert_email
          from staff.orgs where slug = ${org}
      `
    )[0],
    reports: await sql<{ cadence: string; email: string }[]>`
      select cadence, email from staff.report_subscriptions
       where org_slug = ${org} and active
    `,
  }));

  const s = data.settings;
  const has = (c: string) => data.reports.some((r) => r.cadence === c);
  const reportEmail =
    data.reports[0]?.email ?? s.owner_alert_email ?? "";

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <h1 className="st-h1">Clinic settings</h1>
        <p className="st-page-sub">{s.name}</p>
      </header>

      {saved && (
        <div className="st-notice" role="status">
          <strong>Saved.</strong>
          <span>These take effect on the next log filed.</span>
        </div>
      )}
      {e && ERRORS[e] && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>Not saved</strong>
          <span>{ERRORS[e]}</span>
        </div>
      )}

      <form className="st-log" method="POST" action="/api/staff/settings">
        <section className="st-set-block">
          <h2 className="st-set-h">Where the clinic is</h2>
          <p className="st-set-b">
            Used for two things: stamping where each log was filed from,
            and working out when &ldquo;today&rdquo; starts for reminders
            and reports.
          </p>

          <label className="st-field">
            <span className="st-field-label">Timezone</span>
            <input
              className="st-input"
              name="timezone"
              defaultValue={s.timezone}
              placeholder="America/New_York"
            />
            <span className="st-field-hint">
              Region/City. Never an abbreviation.
            </span>
          </label>

          <AddressLookup initialLat={s.latitude} initialLng={s.longitude} />
        </section>

        <section className="st-set-block">
          <h2 className="st-set-h">Filing from off-site</h2>
          <p className="st-set-b">
            Browser location can be spoofed and is routinely 50&ndash;150m
            out indoors, so this records and surfaces rather than blocks.
            An off-site filing still files &mdash; it is stamped, needs a
            written reason, and lands in front of you.
          </p>

          <label className="st-field">
            <span className="st-field-label">How far counts as on-site</span>
            <input
              className="st-input"
              name="geofence_radius_m"
              type="number"
              min={25}
              max={5000}
              step={5}
              defaultValue={s.geofence_radius_m}
            />
            <span className="st-field-hint">
              Metres. 150 covers a building and its parking.
            </span>
          </label>

          <fieldset className="st-set-radios">
            <legend className="st-field-label">Location recording</legend>
            {[
              ["off", "Off", "Don't ask for location at all."],
              [
                "record",
                "Record",
                "Ask, stamp every filing, require a written reason when off-site. Recommended.",
              ],
              [
                "require",
                "Require a reason and flag hard",
                "Same as Record, but off-site filings are escalated. Needs coordinates set above.",
              ],
            ].map(([value, label, hint]) => (
              <label className="st-set-radio" key={value}>
                <input
                  type="radio"
                  name="geofence_mode"
                  value={value}
                  defaultChecked={s.geofence_mode === value}
                />
                <span>
                  <strong>{label}</strong>
                  <em>{hint}</em>
                </span>
              </label>
            ))}
          </fieldset>
        </section>

        <section className="st-set-block">
          <h2 className="st-set-h">Who hears when something is wrong</h2>
          <p className="st-set-b">
            An out-of-range reading is sent immediately, at any hour.
            Everything else is collected into a digest at 9am and 5pm.
            Leave an address blank and that person is not told.
          </p>

          <label className="st-field">
            <span className="st-field-label">Owner</span>
            <input
              className="st-input"
              name="owner_alert_email"
              type="email"
              defaultValue={s.owner_alert_email ?? ""}
              placeholder="you@clinic.com"
            />
          </label>

          <label className="st-field">
            <span className="st-field-label">Medical director</span>
            <input
              className="st-input"
              name="medical_director_alert_email"
              type="email"
              defaultValue={s.medical_director_alert_email ?? ""}
              placeholder="md@clinic.com"
            />
          </label>
        </section>

        <section className="st-set-block">
          <h2 className="st-set-h">Scheduled reports</h2>
          <p className="st-set-b">
            A link rather than an attachment, because these name people and
            an emailed PDF cannot be recalled. Sent at 7am in the clinic&rsquo;s
            own timezone, with the exception count in the subject line.
          </p>

          <label className="st-field">
            <span className="st-field-label">Send reports to</span>
            <input
              className="st-input"
              name="report_email"
              type="email"
              defaultValue={reportEmail}
              placeholder="you@clinic.com"
            />
            <span className="st-field-hint">
              Can be somebody with no staff account &mdash; an owner or an
              outside accountant.
            </span>
          </label>

          <div className="st-set-checks">
            {[
              ["report_daily", "daily", "Daily", "Yesterday, every morning."],
              ["report_weekly", "weekly", "Weekly", "Monday, covering the week just finished."],
              ["report_monthly", "monthly", "Monthly", "On the 1st, covering last month."],
            ].map(([name, cadence, label, hint]) => (
              <label className="st-set-check" key={name}>
                <input
                  type="checkbox"
                  name={name}
                  defaultChecked={has(cadence)}
                />
                <span>
                  <strong>{label}</strong>
                  <em>{hint}</em>
                </span>
              </label>
            ))}
          </div>
        </section>

        <button className="st-primary" type="submit">
          Save settings
        </button>
      </form>
    </div>
  );
}

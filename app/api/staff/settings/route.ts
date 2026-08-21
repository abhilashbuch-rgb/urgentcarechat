import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/settings — the clinic's own settings, set by its owner.
//
// WHY THIS EXISTS AT ALL. Until now these columns were writable only by
// hand in the SQL editor, which meant every clinic that signed up had no
// coordinates, no alert address and no reports — so geolocation stamping
// measured against nothing, an excursion emailed nobody, and the digest
// had no subscriber. Three headline features silently off on a product
// that otherwise looked like it was working. One clinic is a chore; a
// hundred is a business that does not function.
//
// A plain form POST, like the team controls, so it works on a phone with
// a flaky connection and the navigation itself is the feedback.

export const runtime = "nodejs";

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s);

/** Region/City only. An abbreviation has no daylight-saving rule, so
 *  every reminder and report drifts by an hour for half the year — the
 *  bug this check exists to prevent is 'EST'. */
const isIanaZone = (s: string) => /^[A-Za-z]+\/[A-Za-z0-9_+-]+$/.test(s);

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  // The clinic's address and who gets told when something is wrong are
  // the owner's decisions, not a medical assistant's.
  if (!atLeast(session.role, "org_admin")) {
    return redirectAfterPost("/staff?e=forbidden");
  }

  const form = await req.formData();
  const str = (k: string) => String(form.get(k) ?? "").trim();

  const timezone = str("timezone");
  if (!isIanaZone(timezone)) {
    return redirectAfterPost("/staff/settings?e=timezone");
  }

  // Coordinates are optional — a clinic that has not looked them up yet
  // should still be able to save an alert address. But half a coordinate
  // is worse than none: it would place the clinic on the equator or the
  // prime meridian and stamp every filing as thousands of miles away.
  const latRaw = str("latitude");
  const lngRaw = str("longitude");
  const hasLat = latRaw !== "";
  const hasLng = lngRaw !== "";
  if (hasLat !== hasLng) {
    return redirectAfterPost("/staff/settings?e=halfcoord");
  }
  const lat = hasLat ? Number(latRaw) : null;
  const lng = hasLng ? Number(lngRaw) : null;
  if (
    (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
    (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))
  ) {
    return redirectAfterPost("/staff/settings?e=coords");
  }

  const radius = Number(str("geofence_radius_m") || "150");
  if (!Number.isFinite(radius) || radius < 25 || radius > 5000) {
    return redirectAfterPost("/staff/settings?e=radius");
  }

  const mode = str("geofence_mode");
  if (!["off", "record", "require"].includes(mode)) {
    return redirectAfterPost("/staff/settings?e=mode");
  }
  // The CHECK on staff.orgs refuses 'require' without coordinates, and a
  // constraint violation here would surface as a 500. Caught first so it
  // reads as the explanation it is.
  if (mode === "require" && lat === null) {
    return redirectAfterPost("/staff/settings?e=requireneedscoords");
  }

  const ownerEmail = str("owner_alert_email");
  const mdEmail = str("medical_director_alert_email");
  if (ownerEmail && !isEmail(ownerEmail)) {
    return redirectAfterPost("/staff/settings?e=owneremail");
  }
  if (mdEmail && !isEmail(mdEmail)) {
    return redirectAfterPost("/staff/settings?e=mdemail");
  }

  const wantDaily = form.get("report_daily") !== null;
  const wantWeekly = form.get("report_weekly") !== null;
  const wantMonthly = form.get("report_monthly") !== null;
  const reportEmail = str("report_email");
  if ((wantDaily || wantWeekly || wantMonthly) && !isEmail(reportEmail)) {
    return redirectAfterPost("/staff/settings?e=reportemail");
  }

  try {
    await withSession(session, async (sql) => {
      // Through a function, not a direct UPDATE. staff.orgs carries the
      // billing state as well as the clinic's settings, and its RLS
      // policy requires a super admin to write the row — correctly, since
      // a policy loose enough to let an owner set their timezone would
      // also let them set is_read_only = false. The function reaches the
      // settings columns and nothing else.
      await sql`
        select staff.update_org_settings(
          ${org}, ${timezone}, ${lat}, ${lng},
          ${Math.round(radius)}, ${mode},
          ${ownerEmail || null}, ${mdEmail || null}
        )
      `;

      // WHICH OPTIONAL LOGS THIS CLINIC RUNS.
      //
      // An unchecked box is not submitted at all, so "off" cannot be read
      // off the form — the set of switchable logs has to come from the
      // database and each one compared against whether its box arrived.
      // Reading the list from the request instead would let a crafted
      // POST name any slug it liked; set_log_enabled refuses a
      // non-optional template anyway, but the list belongs on the server
      // regardless.
      const switchable = await sql<{ slug: string; active: boolean }[]>`
        select slug, active from staff.optional_logs
      `;
      for (const log of switchable) {
        const wanted = form.get(`log_${log.slug}`) !== null;
        if (wanted !== log.active) {
          await sql`select staff.set_log_enabled(${org}, ${log.slug}, ${wanted})`;
        }
      }

      // Subscriptions are deactivated rather than deleted, so
      // last_period_end survives and turning a report back on does not
      // resend a month of history.
      for (const [want, cadence, dow] of [
        [wantDaily, "daily", null],
        [wantWeekly, "weekly", 1],
        [wantMonthly, "monthly", null],
      ] as const) {
        if (want) {
          await sql`
            insert into staff.report_subscriptions
              (org_slug, email, label, cadence, send_hour, send_dow, send_dom)
            values (${org}, ${reportEmail}, ${"Owner — " + cadence},
                    ${cadence}, 7, ${dow}, ${cadence === "monthly" ? 1 : null})
            on conflict (org_slug, email, cadence) do update
              set active = true, send_hour = excluded.send_hour
          `;
        } else {
          await sql`
            update staff.report_subscriptions set active = false
             where org_slug = ${org} and cadence = ${cadence}
          `;
        }
      }
    });
  } catch (err) {
    // Logged, because the operator sees only "that didn't save" and the
    // reason is almost always a constraint name or a missing grant — the
    // two things that are obvious in a log and invisible in a redirect.
    console.error(
      "[staff-settings] save failed for org",
      org,
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/settings?e=save");
  }

  return redirectAfterPost("/staff/settings?saved=1");
}

import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/settings/reminders — when the morning huddle, the AM/PM
// digest, and the two escalating "still not done" check-ins go out.
//
// OWNER-ONLY, DELIBERATELY STRICTER THAN /api/staff/settings (manager-
// level). A SEPARATE ROUTE ON PURPOSE, same reasoning as
// app/api/staff/billing-contact/route.ts: a shared form's route only
// checks one role once for everything it accepts, so a field folded
// into it can only ever be as protected as the loosest thing next to
// it. These times decide whether an out-of-range reading's escalation
// and both check-ins land on schedule -- not a manager's field to
// quietly push back an hour.
//
// STAFF HAVE NO TOGGLE HERE OR ANYWHERE ELSE FOR THESE. The huddle and
// the two check-ins already have no per-person opt-out (see
// staff-morning-huddle.sql and staff-task-followups.sql); this route
// is what an owner uses to move WHEN they fire, not whether.

export const runtime = "nodejs";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "org_admin")) {
    return redirectAfterPost("/staff/settings?e=remindersforbidden");
  }

  const form = await req.formData();
  const time = (k: string) => String(form.get(k) ?? "").trim();

  const huddleAt = time("huddle_at");
  const digestAm = time("digest_am_at");
  const digestPm = time("digest_pm_at");
  const checkin1 = time("checkin_1_at");
  const checkin2 = time("checkin_2_at");

  for (const t of [huddleAt, digestAm, digestPm, checkin1, checkin2]) {
    if (!TIME_RE.test(t)) {
      return redirectAfterPost("/staff/settings?e=remindertime");
    }
  }

  try {
    await withSession(session, async (sql) => {
      await sql`
        select staff.update_reminder_times(
          ${org}, ${huddleAt}, ${digestAm}, ${digestPm}, ${checkin1}, ${checkin2}
        )
      `;
      await sql`
        insert into staff.audit_log (org_slug, actor_id, action, entity, detail)
        values (${org}, ${session.uid}, 'reminder_times_changed', 'org',
                ${sql.json({
                  huddle_at: huddleAt,
                  digest_am_at: digestAm,
                  digest_pm_at: digestPm,
                  checkin_1_at: checkin1,
                  checkin_2_at: checkin2,
                })})
      `;
    });
  } catch (err) {
    console.error(
      "[staff-settings-reminders] save failed for org",
      org,
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/settings?e=save");
  }

  return redirectAfterPost("/staff/settings?saved=1");
}

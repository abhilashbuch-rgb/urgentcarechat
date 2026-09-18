import type { StaffSql } from "@/lib/staff/db";
import { onDutyToday } from "@/lib/staff/roster-today";
import { jobLabel } from "@/lib/staff/roles";
import { enqueue } from "@/lib/staff/alerts";
import { SLOT_LABELS } from "@/lib/staff/forms";

// A specific check, missed, attributed to whoever was actually on duty
// for it — "missed by Natalia," not "missed by nobody." See
// supabase/staff-shift-miss-per-check.sql for why this is a separate,
// stricter signal from the ordinary per-template "missed_task" alert
// (which fires for the same overdue check, immediately, but
// deliberately anonymous — see that alert's own comment in
// app/api/cron/alerts/route.ts): this one only ever fires when there
// is a real, named person to attribute the miss to, and it is the one
// that counts against that person's record for the year.
//
// RUN EVERY HOUR, IDEMPOTENT. detectAndRecordMissedShifts() is called
// from the same cron pass as the ordinary late-task sweep. The unique
// index on staff.shift_misses (now keyed by template, not just role)
// means trying the same insert on every later hour of the same day is
// a no-op — the miss is recorded, and alerted on, exactly once.

interface OverdueCheck {
  templateId: string;
  formName: string;
  slot: "am" | "pm";
  jobRoles: string[];
}

/** Every check currently overdue for this org — same view, same am/pm
 *  threshold, staff.overdue_today's own missed_task alert already
 *  uses. org_slug = ${org} is LOAD-BEARING here, not defensive: this
 *  runs under platform_super_admin (see app/api/cron/alerts/route.ts's
 *  identical comment on the exact same hazard), whose RLS bypass makes
 *  every org's rows visible unless the query filters them itself. */
async function overdueChecks(sql: StaffSql, org: string): Promise<OverdueCheck[]> {
  return sql<OverdueCheck[]>`
    select template_id as "templateId", name as "formName", slot, job_roles as "jobRoles"
      from staff.overdue_today
     where org_slug = ${org}
  `;
}

export interface MissedCheckOutcome {
  templateId: string;
  formName: string;
  slot: string;
  jobRole: string;
  personNames: string[];
  recorded: boolean;
}

/** Detect, record, and alert on every overdue check that has a real,
 *  named person to attribute it to. Safe to call every hour — see the
 *  header above. One overdue check naming two roles (a dual
 *  responsibility, like a narcotics count) is recorded and alerted on
 *  once per role, same reasoning lib/staff/alerts.ts's groupByRole()
 *  already uses: each accountable person sees it as theirs, not as a
 *  shared line nobody owns. */
export async function detectAndRecordMissedShifts(
  sql: StaffSql,
  org: string,
  facilityType: string | null
): Promise<MissedCheckOutcome[]> {
  const overdue = await overdueChecks(sql, org);
  if (overdue.length === 0) return [];

  // Computed once per call, not once per check — onDutyToday() already
  // returns every role's roster in one pass.
  const roster = await onDutyToday(sql, org, facilityType);
  const rosterByRole = new Map(roster.map((r) => [r.jobRole, r.people.map((p) => p.name)]));

  const outcomes: MissedCheckOutcome[] = [];

  for (const check of overdue) {
    for (const jobRole of check.jobRoles) {
      const personNames = rosterByRole.get(jobRole) ?? [];
      // NOBODY ROSTERED — a staffing gap, not a person's failure. The
      // existing missed_task alert already told the owner this check
      // is late, anonymously; this one exists to name a name, and
      // there isn't one to give, so no row, no email. See the header
      // of supabase/staff-shift-miss-alerts.sql.
      if (personNames.length === 0) continue;

      const inserted = await sql<{ id: string }[]>`
        insert into staff.shift_misses
          (org_slug, work_date, slot, job_role, template_id, form_name, person_names)
        select ${org}, (now() at time zone o.timezone)::date, ${check.slot},
               ${jobRole}::staff.job_role, ${check.templateId}, ${check.formName},
               ${sql.array(personNames)}
          from staff.orgs o where o.slug = ${org}
        on conflict (org_slug, work_date, slot, job_role, template_id) do nothing
        returning id
      `;
      const recorded = inserted.length > 0;
      outcomes.push({
        templateId: check.templateId,
        formName: check.formName,
        slot: check.slot,
        jobRole,
        personNames,
        recorded,
      });
      if (!recorded) continue;

      await alertOnMissedCheck(
        sql,
        org,
        check.slot,
        jobRole,
        check.templateId,
        check.formName,
        personNames,
        facilityType
      );
    }
  }

  return outcomes;
}

/** This year's count for one person, AFTER today's miss (if any) is
 *  already recorded — so the number in the email is the number a
 *  reader can act on immediately, not one that reads low by exactly
 *  one until tomorrow's cron pass.
 *
 *  Exported for app/staff/me/page.tsx: a person's own record of this
 *  should be visible to them, not just to admin — the same "it is
 *  theirs, not the employer's copy of it" rule that page's own header
 *  already states for everything else on it. */
export async function yearlyMissCount(sql: StaffSql, org: string, personName: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    select count(*) as count
      from staff.shift_misses m
      join staff.orgs o on o.slug = m.org_slug
     where m.org_slug = ${org}
       and m.work_date >= date_trunc('year', now() at time zone o.timezone)::date
       and ${personName} = any(m.person_names)
  `;
  return Number(row?.count ?? 0);
}

/** The stern, admin-only warning naming exactly who missed exactly
 *  what. Never sent to the person it names — the count exists so an
 *  owner can act on a pattern, not so the roster reads as a scoreboard
 *  everyone on shift can see. Uses the same owner/director alert_queue
 *  path as an excursion, which is already admin-only by construction
 *  (staff.orgs.owner_alert_email / medical_director_alert_email — see
 *  lib/staff/alerts.ts's sweep()). */
async function alertOnMissedCheck(
  sql: StaffSql,
  org: string,
  slot: "am" | "pm",
  jobRole: string,
  templateId: string,
  formName: string,
  personNames: string[],
  facilityType: string | null
): Promise<void> {
  const slotLabel = SLOT_LABELS[slot] ?? slot.toUpperCase();
  const roleLabel = jobLabel(jobRole, facilityType);

  const counts = await Promise.all(
    personNames.map(async (name) => ({ name, count: await yearlyMissCount(sql, org, name) }))
  );

  // "Missed by Natalia" for one name; joint, named, for a shared role
  // — see this function's own header and detectAndRecordMissedShifts()'s
  // comment on why a dual-responsibility check counts against everyone
  // who held the role that day rather than guessing which one.
  const who = counts
    .map((c) => `${c.name} (${c.count} missed check${c.count === 1 ? "" : "s"} this year)`)
    .join(", ");

  const subject = `MISSED — ${formName} (${slotLabel}) — missed by ${personNames.join(", ")} — ${org}`;
  const body = [
    `${formName} (${slotLabel}) was due for ${roleLabel} and was not filed.`,
    "",
    `Missed by: ${who}`,
    "",
    "This is visible to admin only. Address it directly with the person named above.",
  ].join("\n");

  await enqueue(sql, {
    org,
    kind: "missed_shift",
    subject,
    body,
    sourceKind: "shift_miss",
    // Stable per (day, slot, role, check) — matches
    // staff_alert_queue_once's (org, source_kind, source_id, kind)
    // index, so this alert can never double-send even if something
    // upstream ever retries it.
    sourceId: `${jobRole}:${slot}:${templateId}:${new Date().toISOString().slice(0, 10)}`,
  });
}

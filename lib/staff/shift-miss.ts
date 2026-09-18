import type { StaffSql } from "@/lib/staff/db";
import { onDutyToday } from "@/lib/staff/roster-today";
import { jobLabel } from "@/lib/staff/roles";
import { enqueue } from "@/lib/staff/alerts";
import { SLOT_LABELS } from "@/lib/staff/forms";

// A whole shift's logs, filed by nobody — see supabase/staff-shift-miss-alerts.sql
// for why this is a separate, stricter signal from the ordinary
// per-template "missed_task" alert, and why it only ever names someone
// who was actually rostered.
//
// RUN EVERY HOUR, IDEMPOTENT. detectAndRecordMissedShifts() is called
// from the same cron pass as the ordinary late-task sweep. The unique
// index on staff.shift_misses means trying the same insert on every
// later hour of the same day is a no-op — the miss is recorded, and
// alerted on, exactly once.

interface EmptyRoleSlot {
  slot: "am" | "pm";
  job_role: string;
}

/** Roles whose entire slot came up with nothing filed at all, and
 *  whose slot has actually closed (same am/pm threshold
 *  staff.overdue_today uses) — not "still due," genuinely over. */
async function fullyMissedRoleSlots(
  sql: StaffSql,
  org: string
): Promise<EmptyRoleSlot[]> {
  return sql<EmptyRoleSlot[]>`
    with org_row as (
      select timezone, operating_hours_end from staff.orgs where slug = ${org}
    ),
    due as (
      select l.slot, unnest(l.job_roles) as job_role, l.response_id
        from staff.todays_logs l, org_row o
       where l.org_slug = ${org}
         and (
           (l.slot = 'am' and (now() at time zone o.timezone)::time > time '11:00')
           or (l.slot = 'pm' and (now() at time zone o.timezone)::time
                 > (o.operating_hours_end - interval '1 hour'))
         )
    )
    select slot, job_role
      from due
     group by slot, job_role
    -- Something was actually due (the group exists at all) and NONE
    -- of it was filed — a partial miss (some filed, some not) is
    -- already what staff.overdue_today's per-template alert covers,
    -- and is a different, milder thing than a shift with nothing in
    -- it at all.
    having count(response_id) = 0
  `;
}

export interface MissedShiftOutcome {
  slot: string;
  jobRole: string;
  personNames: string[];
  recorded: boolean;
}

/** Detect, record, and alert on every role whose whole slot came up
 *  empty today. Safe to call every hour — see the header above. */
export async function detectAndRecordMissedShifts(
  sql: StaffSql,
  org: string,
  facilityType: string | null
): Promise<MissedShiftOutcome[]> {
  const empty = await fullyMissedRoleSlots(sql, org);
  if (empty.length === 0) return [];

  // Computed once per call, not once per role — onDutyToday() already
  // returns every role's roster in one pass.
  const roster = await onDutyToday(sql, org, facilityType);
  const rosterByRole = new Map(roster.map((r) => [r.jobRole, r.people.map((p) => p.name)]));

  const outcomes: MissedShiftOutcome[] = [];

  for (const { slot, job_role } of empty) {
    const personNames = rosterByRole.get(job_role) ?? [];
    // NOBODY ROSTERED — a staffing gap, not a person's failure. The
    // existing missed_task alerts already told the owner these
    // templates are late; this alert exists to name a name, and there
    // isn't one to give, so no row, no email. See the header of
    // supabase/staff-shift-miss-alerts.sql.
    if (personNames.length === 0) continue;

    const inserted = await sql<{ id: string }[]>`
      insert into staff.shift_misses (org_slug, work_date, slot, job_role, person_names)
      select ${org}, (now() at time zone o.timezone)::date, ${slot}, ${job_role}::staff.job_role,
             ${sql.array(personNames)}
        from staff.orgs o where o.slug = ${org}
      on conflict (org_slug, work_date, slot, job_role) do nothing
      returning id
    `;
    const recorded = inserted.length > 0;
    outcomes.push({ slot, jobRole: job_role, personNames, recorded });
    if (!recorded) continue;

    await alertOnMissedShift(sql, org, slot as "am" | "pm", job_role, personNames, facilityType);
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

/** The stern, admin-only warning. Never sent to the person it names —
 *  see the request this was built for: the count exists so an owner
 *  can act on a pattern, not so the roster reads as a scoreboard
 *  everyone on shift can see. Uses the same owner/director alert_queue
 *  path as an excursion, which is already admin-only by construction
 *  (staff.orgs.owner_alert_email / medical_director_alert_email — see
 *  lib/staff/alerts.ts's sweep()). */
async function alertOnMissedShift(
  sql: StaffSql,
  org: string,
  slot: "am" | "pm",
  jobRole: string,
  personNames: string[],
  facilityType: string | null
): Promise<void> {
  const slotLabel = SLOT_LABELS[slot] ?? slot.toUpperCase();
  const roleLabel = jobLabel(jobRole, facilityType);

  const counts = await Promise.all(
    personNames.map(async (name) => ({ name, count: await yearlyMissCount(sql, org, name) }))
  );

  const who = counts
    .map((c) => `${c.name} — ${c.count} missed shift${c.count === 1 ? "" : "s"} this year`)
    .join("\n  ");

  const subject = `MISSED SHIFT — ${roleLabel} (${slotLabel}) filed nothing — ${org}`;
  const body = [
    `The entire ${roleLabel} shift (${slotLabel}) went by with NOT ONE required log filed.`,
    "",
    "This is not one missed check. Every log that role owed this shift is unfiled.",
    "",
    "On duty for this shift, and their record for the year so far:",
    `  ${who}`,
    "",
    "This is visible to admin only. Address it directly with the people named above.",
  ].join("\n");

  await enqueue(sql, {
    org,
    kind: "missed_shift",
    subject,
    body,
    sourceKind: "shift_miss",
    // Stable per (day, slot, role) — matches staff_alert_queue_once's
    // (org, source_kind, source_id, kind) index, so this alert can
    // never double-send even if something upstream ever retries it.
    sourceId: `${jobRole}:${slot}:${new Date().toISOString().slice(0, 10)}`,
  });
}

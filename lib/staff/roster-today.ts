import type { StaffSql } from "@/lib/staff/db";
import { jobLabel } from "@/lib/staff/roles";
import { assignmentsToday } from "@/lib/staff/shift-assignments";

// Who is expected to be on duty today, by job — from two sources, read
// as one list. staff.users.workdays (staff-workdays.sql) is the
// recurring weekly pattern for someone with a real account;
// staff.shift_assignments (staff-shift-assignments.sql) is a specific
// date filled in by hand, name only, no account required. Neither one
// is a clock — nobody here has clocked in, this is the schedule an
// administrator set, read back. A name from either source appears the
// same way: the owner was explicit that whoever is actually covering a
// job today belongs on this list, real login or not.

export interface OnDutyPerson {
  name: string;
  /** Has this person actually signed in today (their own local "today",
   *  the org's timezone), not merely been scheduled for it. Always
   *  false for a manual staff.shift_assignments entry — that's a name
   *  with no account behind it, so there is nothing it could sign into.
   *  See OnCallStrip.tsx for the one place this is used to tell "here"
   *  from "expected." */
  signedInToday: boolean;
}

export interface OnDutyRole {
  jobRole: string;
  label: string;
  people: OnDutyPerson[];
}

/** Grouped by job, in the same order the rest of the app lists jobs
 *  (front desk, medical assistant, x-ray tech, provider, center
 *  admin) — see ROLE_ORDER in lib/staff/alerts.ts for the identical
 *  reasoning applied to the digest email. A job nobody is scheduled
 *  for today is simply absent, not shown as empty — this is a roster
 *  of who IS in, not a gap report. */
export async function onDutyToday(
  sql: StaffSql,
  org: string,
  facilityType: string | null
): Promise<OnDutyRole[]> {
  const rows = await sql<
    { job_role: string; display_name: string | null; signed_in_today: boolean }[]
  >`
    select u.job_role, coalesce(u.preferred_name, u.legal_name) as display_name,
           -- "Today" in the CLINIC's day, same boundary every other
           -- comparison on this page uses — a login at 11pm and a login
           -- at 6am the same calendar night should not disagree about
           -- which day they count for just because the device rendering
           -- this page is in a different timezone from the clinic.
           (
             u.last_seen_at is not null
             and (u.last_seen_at at time zone o.timezone)::date
               = (now() at time zone o.timezone)::date
           ) as signed_in_today
      from staff.users u
      join staff.orgs o on o.slug = u.org_slug
     where u.org_slug = ${org}
       and u.active
       and u.job_role is not null
       and extract(isodow from (now() at time zone o.timezone))::smallint = any (u.workdays)
     order by u.job_role, coalesce(u.preferred_name, u.legal_name)
  `;

  const order = ["front_desk", "medical_assistant", "xray_tech", "provider", "center_admin"];
  const byRole = new Map<string, OnDutyPerson[]>();
  for (const r of rows) {
    // preferred_name over legal_name — see supabase/staff-preferred-name.sql
    // for why this banner is the one place that's the right call.
    const person: OnDutyPerson = {
      name: r.display_name ?? "unnamed",
      signedInToday: r.signed_in_today,
    };
    const list = byRole.get(r.job_role);
    if (list) list.push(person);
    else byRole.set(r.job_role, [person]);
  }

  for (const a of await assignmentsToday(sql, org)) {
    const list = byRole.get(a.job_role);
    // Same name assigned twice — a manual entry for a date that also
    // matches someone's own recurring pattern — reads as one person,
    // not two, on a screen that's meant to answer "who's in," not
    // "how many sources agree."
    if (list) {
      if (!list.some((p) => p.name === a.name)) {
        list.push({ name: a.name, signedInToday: false });
      }
    } else byRole.set(a.job_role, [{ name: a.name, signedInToday: false }]);
  }

  return order
    .filter((role) => byRole.has(role))
    .map((role) => ({
      jobRole: role,
      label: jobLabel(role, facilityType),
      people: byRole.get(role)!,
    }));
}

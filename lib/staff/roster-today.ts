import type { StaffSql } from "@/lib/staff/db";
import { jobLabel } from "@/lib/staff/roles";

// Who is expected to be on duty today, by job — read from
// staff.users.workdays (see supabase/staff-workdays.sql). Not a clock:
// nobody here has clocked in, this is the schedule an administrator
// set, read back.

export interface OnDutyRole {
  jobRole: string;
  label: string;
  people: string[];
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
  const rows = await sql<{ job_role: string; legal_name: string | null }[]>`
    select u.job_role, u.legal_name
      from staff.users u
      join staff.orgs o on o.slug = u.org_slug
     where u.org_slug = ${org}
       and u.active
       and u.job_role is not null
       and extract(isodow from (now() at time zone o.timezone))::smallint = any (u.workdays)
     order by u.job_role, u.legal_name
  `;

  const order = ["front_desk", "medical_assistant", "xray_tech", "provider", "center_admin"];
  const byRole = new Map<string, string[]>();
  for (const r of rows) {
    const name = r.legal_name ?? "unnamed";
    const list = byRole.get(r.job_role);
    if (list) list.push(name);
    else byRole.set(r.job_role, [name]);
  }

  return order
    .filter((role) => byRole.has(role))
    .map((role) => ({
      jobRole: role,
      label: jobLabel(role, facilityType),
      people: byRole.get(role)!,
    }));
}

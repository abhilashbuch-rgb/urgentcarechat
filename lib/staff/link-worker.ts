import type { StaffSql } from "@/lib/staff/db";

// Adding someone who already works at one of the owner's OTHER clinics
// to this one — see supabase/staff-multisite-worker.sql for the schema
// this rests on.
//
// DELIBERATELY NARROW. This only ever fires for a plain "staff" invite —
// see the caller in app/api/staff/team/invite/route.ts. An administrator
// invited across clinics already has staff.add_clinic()'s own tested
// path; this file exists for the person who works the floor at more than
// one of the same owner's sites, not the person who runs them.

export interface SiblingAccount {
  userId: string;
}

/**
 * An active HOME account with this email at a different clinic in the
 * same ownership group — null if there is no such account, including
 * when the two clinics are not grouped together at all.
 */
export async function findSiblingHomeAccount(
  sql: StaffSql,
  org: string,
  email: string
): Promise<SiblingAccount | null> {
  const rows = await sql<{ id: string }[]>`
    select u.id
      from staff.users u
      join staff.orgs home_org on home_org.slug = u.org_slug
     where lower(u.email) = ${email}
       and u.active
       and u.person_key = u.id
       and u.org_slug <> ${org}
       and home_org.group_id is not null
       and home_org.group_id = (select group_id from staff.orgs where slug = ${org})
     limit 1
  `;
  return rows[0] ? { userId: rows[0].id } : null;
}

export type LinkResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not_same_group" | "already_linked" | "server_error" };

export async function linkFromSiblingClinic(
  sql: StaffSql,
  args: {
    targetOrg: string;
    homeUserId: string;
    jobRole: string;
    actorId: string;
  }
): Promise<LinkResult> {
  try {
    const rows = await sql<{ link_existing_person: string }[]>`
      select staff.link_existing_person(
        ${args.homeUserId}, ${args.targetOrg},
        ${args.jobRole}::staff.job_role, ${args.actorId}
      )
    `;
    return { ok: true, userId: rows[0].link_existing_person };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not_same_group")) return { ok: false, reason: "not_same_group" };
    if (message.includes("already_linked")) return { ok: false, reason: "already_linked" };
    console.error("[link-worker] link_existing_person failed:", message);
    return { ok: false, reason: "server_error" };
  }
}

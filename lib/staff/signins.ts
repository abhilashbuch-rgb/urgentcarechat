import type { StaffSql } from "@/lib/staff/db";

// Every sign-in is already a row: staff.audit_log gets a 'signin' entry
// from both auth paths (see auth/callback and auth/email/verify), with
// which method was used. This just reads that log back — no new writes,
// no new table, and RLS already confines it to the caller's own org.

export interface SigninEvent {
  id: number;
  created_at: string;
  method: string | null;
}

export async function signinHistory(
  sql: StaffSql,
  org: string,
  userId: string,
  limit = 25
): Promise<SigninEvent[]> {
  return sql<SigninEvent[]>`
    select id, created_at::text as created_at, detail->>'method' as method
      from staff.audit_log
     where org_slug = ${org} and actor_id = ${userId} and action = 'signin'
     order by created_at desc
     limit ${limit}
  `;
}

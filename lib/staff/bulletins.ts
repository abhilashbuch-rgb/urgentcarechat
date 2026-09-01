import type { StaffSql } from "@/lib/staff/db";

// One-way notices from whoever runs the building — see
// supabase/staff-bulletins.sql for why this is deliberately one-way and
// not internal messaging.

export interface Bulletin {
  id: string;
  body: string;
  author_name: string | null;
  author_email: string;
  created_at: string;
}

// A notice about Thursday's fridge service is noise by the following
// month. Aging out on its own means nobody has to remember to clean up
// after themselves — same reasoning as lib/staff/whats-new.ts, applied
// per post instead of to one hardcoded entry. Posting one out early is
// still a delete away for whoever put it up.
const VISIBLE_DAYS = 14;

export async function listBulletins(sql: StaffSql, limit = 5): Promise<Bulletin[]> {
  return sql<Bulletin[]>`
    select b.id, b.body,
           u.legal_name as author_name, u.email as author_email,
           b.created_at::text as created_at
      from staff.bulletins b
      join staff.users u on u.id = b.author_id
     where b.created_at > now() - make_interval(days => ${VISIBLE_DAYS})
     order by b.created_at desc
     limit ${limit}
  `;
}

export async function postBulletin(
  sql: StaffSql,
  org: string,
  authorId: string,
  body: string
): Promise<void> {
  await sql`
    insert into staff.bulletins (org_slug, author_id, body)
    values (${org}, ${authorId}, ${body})
  `;
}

/** Org isolation is RLS's job (see staff-bulletins.sql); who's ALLOWED
 *  to call this at all is app/api/staff/bulletins/route.ts's, same split
 *  as everywhere else in this schema. */
export async function deleteBulletin(sql: StaffSql, id: string): Promise<void> {
  await sql`delete from staff.bulletins where id = ${id}`;
}

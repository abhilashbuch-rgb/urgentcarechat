import type { StaffSql } from "@/lib/staff/db";

// What's still missing on a person's own record — pulled from four
// systems that don't otherwise talk to each other (credentials,
// schedule, e-sign, documents) into one checklist, so knowing whether
// somebody's profile is actually done doesn't mean checking four
// screens by hand.
//
// THE CREDENTIAL HALF USES THE SAME DEFINITION myCredentialWarnings()
// (lib/staff/shift.ts) ALREADY WATCHES: required, and status in
// ('expired', 'expiring', 'missing') — not 'undated'. staff.credential_
// matrix treats an undated credential as present-but-unverifiable, a
// different and narrower problem than "not on file at all," and this
// list would be a second, disagreeing definition of "credential
// problem" if it drew its own line instead of reusing that one.

export interface ProfileGap {
  label: string;
}

interface GapRow {
  user_id: string;
  gaps: { label: string }[];
}

/**
 * Every active person in the org, with their own list of what's still
 * outstanding. One query for the whole roster, same shape as
 * teamStatus() — a clinic's roster is small, and the roster list and
 * the per-person page both need this, so it's read once here rather
 * than twice.
 */
export async function profileGaps(sql: StaffSql, org: string): Promise<Map<string, ProfileGap[]>> {
  const rows = await sql<GapRow[]>`
    select
      u.id as user_id,
      (
        coalesce(
          (
            select jsonb_agg(
                     jsonb_build_object(
                       'label',
                       cm.kind_label || ' — ' ||
                       (case cm.status
                          when 'missing' then 'missing'
                          when 'expired' then 'expired'
                          else 'expiring soon'
                        end)
                     )
                     order by cm.sort_order
                   )
              from staff.credential_matrix cm
             where cm.user_id = u.id
               and cm.required
               and cm.status in ('expired', 'expiring', 'missing')
          ),
          '[]'::jsonb
        ) ||
        (case when cardinality(u.workdays) = 0
          then jsonb_build_array(jsonb_build_object('label', 'Work schedule — not set'))
          else '[]'::jsonb end) ||
        (case when u.esign_consented_at is null
          then jsonb_build_array(jsonb_build_object('label', 'E-sign consent — not on file'))
          else '[]'::jsonb end) ||
        (case when not exists (
            select 1 from staff.user_documents d
             where d.user_id = u.id and d.file_path is not null
          )
          then jsonb_build_array(jsonb_build_object('label', 'No documents uploaded'))
          else '[]'::jsonb end)
      ) as gaps
    from staff.users u
    where u.org_slug = ${org} and u.active
  `;

  return new Map(rows.map((r) => [r.user_id, r.gaps]));
}

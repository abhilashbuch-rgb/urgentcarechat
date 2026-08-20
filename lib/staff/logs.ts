import type { StaffSql } from "@/lib/staff/db";
import { formSchema, type FormSchema } from "@/lib/staff/forms";

// Queries for the operational logs. As elsewhere in this module, none of
// these filter by org — RLS does that, and a second filter here would be
// a second thing to keep in sync.

export interface BoardRow {
  template_id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  frequency: string;
  slot: string;
  response_id: string | null;
  submitted_at: string | null;
  has_out_of_range: boolean | null;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  /** True when this task has no job attached, i.e. it is everyone's. */
  everyone?: boolean;
}

/** Today's board, scoped to one person's clinic job.
 *
 *  The filter is staff.brief_matches(), the same function the database
 *  uses — so what a medical assistant sees here and what the database
 *  says they should see cannot drift apart. Separation is strict: only a
 *  template with no job_roles at all is universal, and a person with no
 *  job assigned sees only those. */
export async function todaysBoard(
  sql: StaffSql,
  jobRole: string | null
): Promise<BoardRow[]> {
  return sql<BoardRow[]>`
    select template_id, slug, name, description, category, frequency, slot,
           response_id, submitted_at::text as submitted_at, has_out_of_range,
           submitted_by_name, submitted_by_email,
           cardinality(job_roles) = 0 as everyone
      from staff.todays_logs
     where staff.brief_matches(job_roles, ${jobRole}::staff.job_role)
     order by sort_order, slot
  `;
}

export interface Template {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  frequency: string;
  slots: string[];
  schema: FormSchema;
}

export async function loadTemplate(
  sql: StaffSql,
  slug: string
): Promise<Template | null> {
  const rows = await sql<
    {
      id: string;
      slug: string;
      name: string;
      description: string | null;
      category: string | null;
      frequency: string;
      slots: string[];
      schema_json: unknown;
    }[]
  >`
    select id, slug, name, description, category, frequency, slots, schema_json
      from staff.form_templates
     where slug = ${slug} and active
  `;
  if (rows.length === 0) return null;

  // A template is data an administrator can edit, so its schema is parsed
  // rather than trusted. A malformed one fails here, where it can be
  // reported, instead of halfway through rendering a form somebody is
  // standing at a fridge trying to fill in.
  const parsed = formSchema.safeParse(rows[0].schema_json);
  if (!parsed.success) return null;

  return { ...rows[0], schema: parsed.data };
}

/** The instance for (template, today, slot), created if this is the first
 *  time anyone has opened it. Concurrent opens race, so the insert is a
 *  no-op on conflict and the row is read back either way. */
export async function ensureInstance(
  sql: StaffSql,
  org: string,
  templateId: string,
  slot: string
): Promise<string> {
  await sql`
    insert into staff.form_instances (template_id, org_slug, due_date, slot)
    values (${templateId}, ${org}, current_date, ${slot})
    on conflict (template_id, due_date, slot) do nothing
  `;
  const rows = await sql<{ id: string }[]>`
    select id from staff.form_instances
     where template_id = ${templateId} and due_date = current_date and slot = ${slot}
  `;
  return rows[0].id;
}

export interface SubmittedLog {
  id: string;
  slug: string;
  name: string;
  slot: string;
  due_date: string;
  submitted_at: string;
  submitted_by_name: string | null;
  submitted_by_email: string;
  answers_json: Record<string, unknown>;
  has_out_of_range: boolean;
  out_of_range_fields: string[];
  corrective_action: string | null;
}

export async function recentLogs(
  sql: StaffSql,
  limit = 60
): Promise<SubmittedLog[]> {
  return sql<SubmittedLog[]>`
    select r.id, t.slug, t.name, i.slot, i.due_date::text as due_date,
           r.submitted_at::text as submitted_at,
           u.legal_name as submitted_by_name, u.email as submitted_by_email,
           r.answers_json, r.has_out_of_range, r.out_of_range_fields,
           r.corrective_action
      from staff.form_responses r
      join staff.form_instances i on i.id = r.instance_id
      join staff.form_templates t on t.id = i.template_id
      join staff.users u on u.id = r.submitted_by
     -- The CURRENT version is the row nothing supersedes, not the row
     -- with a null supersedes_id — that one is the original mistake.
     -- See staff-amend.sql; this read path would otherwise show 55°F
     -- forever while the correction sat in the table unread.
     where not exists (
       select 1 from staff.form_responses newer where newer.supersedes_id = r.id
     )
     order by r.submitted_at desc
     limit ${limit}
  `;
}

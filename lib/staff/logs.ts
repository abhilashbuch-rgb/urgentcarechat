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
  /** Collapsed out of this person's daily view by their own preference.
   *  Never means "not owed" — see staff-board-prefs.sql. Still counted
   *  toward outstanding/flagged totals by every caller of this row. */
  hidden: boolean;
}

/** Today's board, scoped to one person's clinic job, in that person's
 *  own preferred order.
 *
 *  The job filter is staff.brief_matches(), the same function the
 *  database uses — so what a medical assistant sees here and what the
 *  database says they should see cannot drift apart. Separation is
 *  strict: only a template with no job_roles at all is universal, and a
 *  person with no job assigned sees only those.
 *
 *  THE ORDER IS HERS, NOT THE ORIGINAL sort_order, once she has set one.
 *  staff.log_board_prefs is a left join, not a filter — a row with no
 *  saved preference still appears, in the template's original position,
 *  which is why a brand new hire's board looks identical to before this
 *  existed. Hidden rows are RETURNED, not dropped: dropping them here
 *  would make the outstanding count on the page silently exclude a
 *  currently-owed task, which is the exact failure mode a compliance
 *  board cannot have. */
export async function todaysBoard(
  sql: StaffSql,
  jobRole: string | null,
  userId?: string
): Promise<BoardRow[]> {
  return sql<BoardRow[]>`
    select l.template_id, l.slug, l.name, l.description, l.category,
           l.frequency, l.slot,
           l.response_id, l.submitted_at::text as submitted_at,
           l.has_out_of_range,
           l.submitted_by_name, l.submitted_by_email,
           cardinality(l.job_roles) = 0 as everyone,
           coalesce(p.hidden, false) as hidden
      from staff.todays_logs l
      left join staff.log_board_prefs p
             on p.user_id = ${userId ?? null} and p.template_slug = l.slug
     where staff.brief_matches(l.job_roles, ${jobRole}::staff.job_role)
     order by coalesce(p.sort_order, l.sort_order), l.slot
  `;
}

/** One person's saved order/visibility for their own board — the whole
 *  set, replacing whatever was there before. Slugs not present in
 *  `prefs` fall back to the template's default order and stay visible,
 *  which is what lets "reset" just mean "save an empty list." */
export async function saveBoardPrefs(
  sql: StaffSql,
  org: string,
  userId: string,
  prefs: { slug: string; hidden: boolean; sortOrder: number }[]
): Promise<void> {
  await sql`delete from staff.log_board_prefs where user_id = ${userId}`;
  if (prefs.length === 0) return;
  await sql`
    insert into staff.log_board_prefs (org_slug, user_id, template_slug, hidden, sort_order)
    select ${org}, ${userId}, x.slug, x.hidden, x.sort_order
      from jsonb_to_recordset(${sql.json(prefs.map((p) => ({
        slug: p.slug,
        hidden: p.hidden,
        sort_order: p.sortOrder,
      })))}) as x(slug text, hidden boolean, sort_order integer)
  `;
}

export interface BoardTemplate {
  slug: string;
  name: string;
  category: string | null;
  hidden: boolean;
  sort_order: number;
}

/** One row per TEMPLATE, not per slot — the customize screen moves a
 *  twice-daily fridge check as one thing, not as separate "AM" and "PM"
 *  rows that would drift apart from each other. Same job filter as
 *  todaysBoard(), same left join for the same reason: a template with
 *  no saved preference still appears, in its default position. */
export async function boardTemplatesFor(
  sql: StaffSql,
  jobRole: string | null,
  userId: string
): Promise<BoardTemplate[]> {
  return sql<BoardTemplate[]>`
    select t.slug, t.name, t.category,
           coalesce(p.hidden, false) as hidden,
           coalesce(p.sort_order, t.sort_order) as sort_order
      from staff.form_templates t
      left join staff.log_board_prefs p
             on p.user_id = ${userId} and p.template_slug = t.slug
     where t.active
       and staff.brief_matches(t.job_roles, ${jobRole}::staff.job_role)
     order by coalesce(p.sort_order, t.sort_order), t.name
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

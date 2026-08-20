import Link from "next/link";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { CATEGORY_LABELS } from "@/lib/staff/labels";

// Records that exist because something happened.
//
// The day board answers "what is due"; nothing on it can answer "a
// needle went through a glove ten minutes ago". Those records have no
// schedule — putting a sharps injury log on a daily board would create
// an item nobody can ever complete, and a permanently red row teaches
// people that red means nothing.
//
// So they live here, and the page is deliberately dull: a list, what
// each one is for, and the rule that requires it. Somebody arrives on
// this screen having just had a bad minute, and the worst thing it could
// do is make them hunt.
//
// SHOWN TO EVERYONE, not gated to administrators. The person who was
// stuck is the person who knows what happened, and a report that has to
// go through a manager first is a report that gets written from memory
// on Friday, if at all.

export const dynamic = "force-dynamic";

interface EventTemplate {
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  standard: string | null;
  filed_30d: number;
  last_filed: string | null;
}

export default async function RecordsPage() {
  const { session } = await requireStaff();

  const rows = await withSession(session, async (sql) =>
    sql<EventTemplate[]>`
      select t.slug, t.name, t.description, t.category,
             t.schema_json->>'standard' as standard,
             count(r.id) filter (
               where r.submitted_at >= now() - interval '30 days'
             )::int as filed_30d,
             max(r.submitted_at)::text as last_filed
        from staff.form_templates t
        left join staff.form_instances i on i.template_id = t.id
        left join staff.form_responses r on r.instance_id = i.id
       where t.active and t.frequency = 'on_event'
       group by t.slug, t.name, t.description, t.category, t.schema_json
       order by t.sort_order, t.name
    `
  );

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <h1 className="st-h1">Record something that happened</h1>
        <p className="st-page-sub">
          These aren&rsquo;t on the daily board because they have no
          schedule. File one when the thing occurs &mdash; the same day if
          you can, because the detail is what makes the record worth
          having.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="st-empty">
          No event records are set up for this clinic yet.
        </p>
      ) : (
        <ul className="st-rec-list">
          {rows.map((t) => (
            <li key={t.slug} className="st-rec">
              <div className="st-rec-main">
                <span className="st-rec-name">{t.name}</span>
                {t.description && (
                  <span className="st-rec-desc">{t.description}</span>
                )}
                {/* The regulation, in the person's face rather than in a
                    policy binder. "OSHA requires this" is what makes
                    somebody file it at 4pm instead of never. */}
                {t.standard && <span className="st-rec-std">{t.standard}</span>}
                <span className="st-rec-meta">
                  {t.category && CATEGORY_LABELS[t.category]
                    ? `${CATEGORY_LABELS[t.category]} · `
                    : ""}
                  {t.filed_30d === 0
                    ? "None filed in the last 30 days"
                    : `${t.filed_30d} filed in the last 30 days`}
                </span>
              </div>
              <Link className="st-primary st-rec-go" href={`/staff/logs/${t.slug}`}>
                Record
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="st-fine">
        Every one of these is kept for as long as the rule behind it
        requires &mdash; for exposure and injury records that is the
        duration of employment plus thirty years (29 CFR 1910.1020(d)).
        None of them can be edited or deleted afterwards; a correction
        files a new version alongside the original.
      </p>
    </div>
  );
}

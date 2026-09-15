-- ============================================================
-- ONE WEEKDAY PER PERIODIC TASK, NOT "SOMETIME THIS MONTH"
--
-- Run AFTER supabase/staff-statutory-logs.sql. Idempotent.
--
-- staff-statutory-logs.sql already fixed the real bug — a weekly,
-- monthly or quarterly task no longer nags every day of its period,
-- because staff.todays_logs now tracks "done" over the whole period
-- rather than over today alone. What it left unsolved is WHEN in that
-- period the task starts asking: every one of them became visible
-- from day one of its period, so a clinic with eight periodic logs saw
-- all eight at once on the 1st, then nothing until the next reset.
--
-- due_weekday answers "which weekday" for a task that already knows
-- "which week/month/quarter" from period_starts_on. A template stays
-- INVISIBLE (not just "not yet late" — absent from the board and the
-- digest entirely) from the start of its period until the first
-- occurrence of its assigned weekday, then visible for the rest of
-- the period exactly as before. Filing early still counts as done —
-- the visibility gate only ever holds back an UNFILLED row.
--
-- NULL FOR DAILY AND PER_SHIFT, ON PURPOSE. Those are already due
-- every day; a weekday assignment would only ever narrow that, never
-- match the existing "due each day" meaning.
-- ============================================================

alter table staff.form_templates
  add column if not exists due_weekday smallint;

do $$ begin
  alter table staff.form_templates
    add constraint staff_form_templates_due_weekday_range
    check (due_weekday is null or due_weekday between 1 and 5);
exception when duplicate_object then null;
end $$;

comment on column staff.form_templates.due_weekday is
  'ISO weekday (1=Monday..5=Friday) a weekly/monthly/quarterly task '
  'becomes visible on within its period — see staff-due-weekday.sql. '
  'Null for daily/per_shift (already due every day) and for any '
  'periodic task that has not been given one yet, which stays visible '
  'from day one of its period exactly as before this file ran.';

-- CREATE OR REPLACE, NOT DROP. The column list is unchanged — only the
-- WHERE clause gains a visibility check — and staff-statutory-logs.sql
-- already paid once for the lesson that dropping this view silently
-- takes staff.overdue_today (built on top of it) down with it.
create or replace view staff.todays_logs
with (security_invoker = true) as
with period as (
  select t.id,
         case t.frequency
           when 'weekly'    then date_trunc('week',    current_date)::date
           when 'monthly'   then date_trunc('month',   current_date)::date
           when 'quarterly' then date_trunc('quarter', current_date)::date
           else current_date
         end as starts_on
    from staff.form_templates t
)
select
  t.org_slug,
  t.id            as template_id,
  t.slug,
  t.name,
  t.description,
  t.category,
  t.frequency,
  t.sort_order,
  t.job_roles,
  s.slot,
  r.id            as response_id,
  r.submitted_at,
  r.submitted_by,
  r.has_out_of_range,
  r.supersedes_id is not null as is_amendment,
  p.starts_on     as period_starts_on,
  u.legal_name    as submitted_by_name,
  u.email         as submitted_by_email
from staff.form_templates t
join period p on p.id = t.id
cross join lateral unnest(
  case when cardinality(t.slots) = 0 then array[''] else t.slots end
) as s(slot)
left join lateral (
  select r2.*
    from staff.form_responses r2
    join staff.form_instances i2 on i2.id = r2.instance_id
   where i2.template_id = t.id
     and i2.slot = s.slot
     and i2.due_date >= p.starts_on
     and not exists (
           select 1 from staff.form_responses newer
            where newer.supersedes_id = r2.id
         )
   order by r2.submitted_at desc
   limit 1
) r on true
left join staff.users u on u.id = r.submitted_by
where t.active
  and t.frequency <> 'on_event'
  -- The one addition: an unfilled row for a template with a
  -- due_weekday stays out of the board entirely until the first
  -- occurrence of that weekday on or after the period started. A
  -- filled row (r.id is not null) is never held back by this — early
  -- is still done.
  and (
    r.id is not null
    or t.due_weekday is null
    or current_date >= (
         p.starts_on
         + (((t.due_weekday - extract(isodow from p.starts_on)::int) + 7) % 7)
       )
  );

grant select on staff.todays_logs to staff_app;

-- ============================================================
-- THE SCHEDULE — one or two periodic tasks a day, Monday to Friday
--
-- Applied to every org's own copy of these templates, plus the
-- _library source rows so a clinic provisioned after this file runs
-- inherits the same schedule instead of everything landing on day one
-- again. Grouped by which weekday, not by table row, so the spread is
-- easy to read back later.
-- ============================================================

update staff.form_templates set due_weekday = 1  -- Monday
 where slug in ('eyewash-autoclave', 'fire-extinguisher');

update staff.form_templates set due_weekday = 2  -- Tuesday
 where slug in ('poct-qc', 'urinalysis-qc');

update staff.form_templates set due_weekday = 3  -- Wednesday
 where slug in ('equipment-calibration', 'radiation-apron');

update staff.form_templates set due_weekday = 4  -- Thursday
 where slug = 'qi-minutes';

update staff.form_templates set due_weekday = 5  -- Friday
 where slug = 'hazcom-inventory';

-- ============================================================
-- THE THREE THAT BELONGED TO NOBODY
--
-- job_roles = '{}' means "everyone's board" (staff.brief_matches), not
-- "assigned" — three real templates were sitting there unowned. All
-- three are facility upkeep, not clinical work, so they follow the
-- same job center admin already carries elsewhere (the day sheet, the
-- waste manifest, the QI review) — except the fire extinguisher check,
-- which front desk already half-does on the daily lobby walk
-- (front-desk-open's own lobby_clear field) and is a better fit for
-- "the person who is in the building every single day" than for an
-- administrator who may not be on site daily.
-- ============================================================

update staff.form_templates
   set job_roles = array['front_desk']::staff.job_role[]
 where slug = 'fire-extinguisher';

update staff.form_templates
   set job_roles = array['center_admin']::staff.job_role[]
 where slug in ('equipment-calibration', 'hazcom-inventory');

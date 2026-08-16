-- ============================================================
-- OPERATIONAL LOGS — schema additions
--
-- Run AFTER supabase/staff-schema.sql. Idempotent; safe to re-run.
--
-- The log tables (form_templates / form_instances / form_responses) already
-- exist from staff-schema.sql. This file adds what turning them into an
-- actual daily workflow needs: a URL slug, a shift slot, and the
-- out-of-range fields.
--
-- DESIGN NOTE — instances are created on demand, not by a nightly job.
-- A cron that pre-creates today's rows is one more thing that can fail
-- silently at 3am and leave a clinic with no logs to fill in. Instead the
-- row is created the moment someone opens the form, keyed on
-- (template, date, slot) so opening it twice is the same row.
-- ============================================================

-- A stable, readable identifier for the URL: /staff/logs/temp-fridge.
-- The display name can be reworded without breaking a bookmark or an
-- entry in someone's muscle memory.
alter table staff.form_templates add column if not exists slug text;
alter table staff.form_templates add column if not exists description text;
-- Which shifts this form is due in. Empty means once a day, any time.
alter table staff.form_templates add column if not exists slots text[] not null default '{}';
-- Ordering on the "today" screen. Opening checks before closing checks.
alter table staff.form_templates add column if not exists sort_order integer not null default 100;

create unique index if not exists staff_templates_slug
  on staff.form_templates (org_slug, slug) where slug is not null;

-- 'am' | 'pm' | '' — part of the identity of an instance, because a
-- twice-daily fridge check is two separate records on the same date and
-- the original unique constraint could only hold one.
alter table staff.form_instances add column if not exists slot text not null default '';

do $$ begin
  alter table staff.form_instances drop constraint if exists form_instances_template_id_due_date_key;
exception when undefined_object then null;
end $$;

create unique index if not exists staff_instances_identity
  on staff.form_instances (template_id, due_date, slot);

-- Out-of-range handling.
--
-- A value outside its threshold is not just a flag on a row — it is the
-- whole reason a temperature log exists. The corrective action is stored
-- alongside the answers rather than inside them so it can be queried,
-- alerted on, and shown to a surveyor without parsing JSON.
alter table staff.form_responses add column if not exists has_out_of_range boolean not null default false;
alter table staff.form_responses add column if not exists out_of_range_fields text[] not null default '{}';
alter table staff.form_responses add column if not exists corrective_action text;

-- A response that reports an out-of-range value MUST carry a corrective
-- action. Enforced here and not only in the form, because "the technician
-- can't submit without it" and "the record cannot exist without it" are
-- different guarantees, and only the second one survives a future API,
-- an import, or a bug in the client.
do $$ begin
  alter table staff.form_responses
    add constraint staff_response_needs_corrective_action
    check (
      not has_out_of_range
      or (corrective_action is not null and length(btrim(corrective_action)) >= 3)
    );
exception when duplicate_object then null;
end $$;

-- One live response per instance.
--
-- Without this a form could be filed twice for the same shift — I did it
-- by accident while testing — and the board would show the same log
-- twice with no way to tell which reading was the real one. A correction
-- is a new row pointing at the one it supersedes (supersedes_id), which
-- is why the index is partial rather than a plain unique constraint.
create unique index if not exists staff_responses_one_live
  on staff.form_responses (instance_id) where supersedes_id is null;

create index if not exists staff_responses_flagged
  on staff.form_responses (org_slug, submitted_at desc) where has_out_of_range;

-- ============================================================
-- TODAY'S BOARD
--
-- Every active template crossed with the slots it is due in, left-joined
-- to whatever has been submitted for today. security_invoker so it reads
-- under the caller's org context — see the note in staff-onboarding.sql
-- about views otherwise running as their owner and bypassing RLS.
-- ============================================================

create or replace view staff.todays_logs
with (security_invoker = true) as
select
  t.org_slug,
  t.id            as template_id,
  t.slug,
  t.name,
  t.description,
  t.category,
  t.frequency,
  t.sort_order,
  s.slot,
  r.id            as response_id,
  r.submitted_at,
  r.submitted_by,
  r.has_out_of_range,
  u.legal_name    as submitted_by_name,
  u.email         as submitted_by_email
from staff.form_templates t
-- '{}' means "once, any time of day", which unnest would turn into no
-- rows at all — so an empty slots array becomes a single empty slot.
cross join lateral unnest(
  case when cardinality(t.slots) = 0 then array[''] else t.slots end
) as s(slot)
left join staff.form_instances i
  on i.template_id = t.id and i.due_date = current_date and i.slot = s.slot
left join staff.form_responses r
  on r.instance_id = i.id and r.supersedes_id is null
left join staff.users u on u.id = r.submitted_by
where t.active;

grant select on staff.todays_logs to staff_app;

-- ============================================================
-- JOB ROLES AND THE SHIFT BRIEF
--
-- Run AFTER supabase/staff-obligations-seed.sql. Idempotent.
--
-- TWO DIFFERENT THINGS CALLED "ROLE", AND THEY MUST NOT BE ONE COLUMN.
--
--   staff.user_role  — what you may DO in this app. org_admin can invite
--                      people; clinical_lead can complete someone else's
--                      obligation. This is permission, and RLS and the
--                      route handlers read it.
--
--   staff.job_role   — what you DO IN THE CLINIC. A medical assistant
--                      checks the fridge; an X-ray tech inspects lead
--                      aprons; the front desk reconciles the drawer.
--                      This is a work assignment, and it decides what
--                      shows up on your screen — never what you are
--                      allowed to reach.
--
-- Collapsing them would mean promoting an MA to org_admin to let them
-- manage the roster, and thereby silently handing them the X-ray tech's
-- task list; or worse, giving someone the fridge log by making them a
-- "clinical_lead" and handing them completion rights over everybody.
-- They are orthogonal, so they are two columns.
--
-- job_role is NULLABLE on purpose. "Nobody has said what this person
-- does" is a real state on day one, and the brief says so out loud
-- rather than guessing and showing a receptionist the narcotics count.
-- ============================================================

do $$ begin
  create type staff.job_role as enum (
    'front_desk',
    'medical_assistant',
    'xray_tech',
    'provider',
    'center_admin'
  );
exception when duplicate_object then null;
end $$;

alter table staff.users add column if not exists job_role staff.job_role;

-- Which jobs a task belongs to. EMPTY MEANS EVERYONE — that is the safe
-- default for a column added to rows that already exist, because the
-- alternative (empty means nobody) would silently empty every clinic's
-- board the moment this migration ran.
alter table staff.form_templates
  add column if not exists job_roles staff.job_role[] not null default '{}';
alter table staff.obligations
  add column if not exists job_roles staff.job_role[] not null default '{}';

create index if not exists staff_templates_job_roles
  on staff.form_templates using gin (job_roles);

-- ============================================================
-- STANDING DIRECTIVES
--
-- Not every daily instruction is a form to fill in or a deadline to
-- meet. "Never quote a price at the clinical desk — walk them to the
-- front" is a rule that governs a shift without ever producing a row.
-- Those had nowhere to live: the log board only shows things with a
-- submit button, and the obligations register only shows things with a
-- due date, so a standing rule was either invisible or filed as a fake
-- task that could be marked done and then forgotten.
--
-- A directive is READ, not completed. It carries an optional
-- acknowledgement so a clinic can prove the rule was put in front of
-- someone, which is a weaker and more honest claim than "they did it".
-- ============================================================

create table if not exists staff.directives (
  id         uuid primary key default gen_random_uuid(),
  org_slug   text not null references staff.orgs(slug) on delete cascade,
  key        text not null,
  job_roles  staff.job_role[] not null default '{}',
  title      text not null,
  body       text not null,
  -- Why this rule exists. A directive that cites its reason survives the
  -- shift where somebody decides it is pointless.
  rationale  text,
  citation   text,
  -- Shown at the top of the brief rather than in the list. Reserved for
  -- the few rules where getting it wrong is the incident.
  critical   boolean not null default false,
  sort_order integer not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists staff_directives_key
  on staff.directives (org_slug, key);

alter table staff.directives enable row level security;
alter table staff.directives force row level security;
drop policy if exists staff_org_isolation on staff.directives;
create policy staff_org_isolation on staff.directives
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());
grant select, insert, update on staff.directives to staff_app;
revoke delete on staff.directives from staff_app;

-- ============================================================
-- THE SHIFT BRIEF
--
-- Today's board, filtered to one person's job. The filter is
-- "unassigned tasks are everyone's" — a template with no job_roles
-- shows for all staff — so adding this column cannot make work vanish
-- from a clinic that has not categorised anything yet.
--
-- SEPARATION IS STRICT. A medical assistant does not see the front
-- desk's drawer reconciliation and the front desk does not see the
-- narcotics count. Only a task with NO job_roles at all is shown to
-- everybody, and that is reserved for things which genuinely are
-- everybody's.
--
-- An earlier version also let a person with no job_role see everything,
-- on the reasoning that showing an unassigned person too much was safer
-- than showing them nothing. That was wrong twice over: it silently
-- broke the separation the moment anyone was left unassigned, and it
-- hid the real problem, which is that nobody had said what this person
-- does. Unassigned now sees only the universal tasks, and the app tells
-- them to get a job assigned — a visible gap an administrator can fix,
-- rather than an invisible leak.
-- ============================================================

create or replace function staff.brief_matches(
  p_task staff.job_role[], p_person staff.job_role
) returns boolean
language sql immutable as $$
  select cardinality(p_task) = 0
      or (p_person is not null and p_person = any (p_task))
$$;

grant execute on function staff.brief_matches(staff.job_role[], staff.job_role) to staff_app;

-- The board has to carry job_roles for the brief to filter on it.
--
-- DROPPED AND RECREATED, not CREATE OR REPLACE. Replace can only append
-- columns to the end of a view; inserting job_roles next to the other
-- template columns where it belongs fails with "cannot change name of
-- view column \"slot\" to \"job_roles\"". Nothing depends on this view,
-- so dropping it is free — but the drop has to come first or the whole
-- migration stops here.
drop view if exists staff.todays_logs cascade;
create view staff.todays_logs
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
  t.job_roles,
  s.slot,
  r.id            as response_id,
  r.submitted_at,
  r.submitted_by,
  r.has_out_of_range,
  u.legal_name    as submitted_by_name,
  u.email         as submitted_by_email
from staff.form_templates t
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

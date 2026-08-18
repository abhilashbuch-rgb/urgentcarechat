-- ============================================================
-- ROUNDS — guided runbooks, walked one step at a time
--
-- Run AFTER supabase/staff-job-roles.sql. Idempotent; safe to re-run.
--
-- WHY THIS IS NOT A FORM, AND NOT A CHECKLIST
-- -------------------------------------------
-- staff.form_templates already holds per-shift tasks with fields and
-- thresholds — the fridge reading, the crash cart seal. Those are
-- measurements, and a measurement needs a box to write the number in.
--
-- A round is the other thing: a physical walk with a fixed order.
-- Restrooms, hydration station, lobby seating, mask station, kiosk. The
-- record that matters is that ONE PERSON walked ALL of it at a stated
-- time, not that fourteen boxes each acquired a tick.
--
-- AND A CHECKLIST OF BOXES IS WORSE THAN NOTHING HERE. Fourteen
-- checkboxes on one screen get ticked top to bottom at the counter
-- without anybody leaving the desk — the form is satisfiable without the
-- walk, which makes the record a lie that looks like evidence. Presented
-- one step at a time, with the next step hidden until the current one is
-- passed, the fastest way through is to actually walk it.
--
-- SO: there is NO per-step stored outcome. A run has a start, an end, a
-- person, and one attestation covering the whole round — the same shape
-- as the paper round sheet it replaces, where you initial the bottom and
-- not each line.
--
-- WHAT SAVES IT FROM BEING A RUBBER STAMP is staff.round_runs.exceptions:
-- any step can have a problem reported against it as you pass through,
-- and that note is the part a manager reads. A round with no exceptions
-- ever recorded is not a clean lobby, it is a round nobody is really
-- walking, and the exception count is what makes that visible.
-- ============================================================

create table if not exists staff.rounds (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  key text not null,

  -- Which job walks this. Same array shape as form_templates so the
  -- brief filters both with staff.brief_matches().
  job_roles staff.job_role[] not null default '{}',

  title text not null,
  -- One line, imperative, shown under the title on the list.
  purpose text,

  -- When it is walked. Free text rather than an enum because clinics
  -- genuinely differ: "every hour", "at open", "at close", "when it
  -- happens". The app groups by this string and does not compute from it.
  cadence text not null default 'as needed',

  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists staff_rounds_key
  on staff.rounds (org_slug, key);

create table if not exists staff.round_steps (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references staff.rounds(id) on delete cascade,
  step_no integer not null,

  -- The instruction. Imperative, one action, no preamble — this is read
  -- standing up with something in the other hand.
  instruction text not null,
  -- The detail that stops it being ambiguous, when there is one.
  detail text,

  created_at timestamptz not null default now()
);

create unique index if not exists staff_round_steps_order
  on staff.round_steps (round_id, step_no);

-- ============================================================
-- A COMPLETED PASS
--
-- started_at is set when the person opens step 1, completed_at when they
-- attest at the end. The gap between them is the only honest signal the
-- system has about whether the walk happened: a fourteen-step lobby
-- round attested four seconds after it started did not.
-- ============================================================

create table if not exists staff.round_runs (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  round_id uuid not null references staff.rounds(id) on delete cascade,

  walked_by uuid not null references staff.users(id),
  started_at timestamptz not null,
  completed_at timestamptz not null default now(),

  -- Problems found on the way round: [{step_no, note}]. Empty is a valid
  -- and common answer; it is the ALL-empty history that means something.
  exceptions jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists staff_round_runs_recent
  on staff.round_runs (org_slug, round_id, completed_at desc);

-- A run that finishes before it starts is a clock problem or a forged
-- record, and either way it should not be storable.
do $$ begin
  alter table staff.round_runs
    add constraint staff_round_run_ordered
    check (completed_at >= started_at);
exception when duplicate_object then null;
end $$;

-- Exceptions have to be a list of objects, not whatever the caller sent.
do $$ begin
  alter table staff.round_runs
    add constraint staff_round_run_exceptions_shape
    check (jsonb_typeof(exceptions) = 'array');
exception when duplicate_object then null;
end $$;

-- ============================================================
-- ROW-LEVEL SECURITY
-- Same shape as every other org-scoped table. See staff-schema.sql.
-- round_steps has no org column of its own; it is reached only through
-- its round, so it is protected by a policy that joins back to one.
-- ============================================================

alter table staff.rounds enable row level security;
alter table staff.rounds force row level security;
drop policy if exists staff_org_isolation on staff.rounds;
create policy staff_org_isolation on staff.rounds
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

alter table staff.round_steps enable row level security;
alter table staff.round_steps force row level security;
drop policy if exists staff_org_isolation on staff.round_steps;
create policy staff_org_isolation on staff.round_steps
  for all
  using (exists (
    select 1 from staff.rounds r
     where r.id = round_steps.round_id
       and (staff.is_super_admin() or r.org_slug = staff.current_org())
  ))
  with check (exists (
    select 1 from staff.rounds r
     where r.id = round_steps.round_id
       and (staff.is_super_admin() or r.org_slug = staff.current_org())
  ));

alter table staff.round_runs enable row level security;
alter table staff.round_runs force row level security;
drop policy if exists staff_org_isolation on staff.round_runs;
create policy staff_org_isolation on staff.round_runs
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.rounds to staff_app;
grant select, insert, update on staff.round_steps to staff_app;
-- Runs are INSERT-ONLY. A completed round is a signed record of where
-- somebody was and when; letting it be edited afterwards would make the
-- timestamp — the only thing that makes the record worth keeping —
-- rewritable. No update grant, and no delete.
grant select, insert on staff.round_runs to staff_app;
revoke delete on staff.rounds from staff_app;
revoke delete on staff.round_steps from staff_app;
revoke update, delete on staff.round_runs from staff_app;

-- ============================================================
-- THE LIST, WITH ITS LAST PASS
--
-- security_invoker so it reads under the caller's org context rather
-- than the view owner's. Dropped first rather than CREATE OR REPLACE:
-- replace can only APPEND columns to a view, so a later migration that
-- inserts a column would break this file's second run.
-- ============================================================

drop view if exists staff.round_board cascade;
create view staff.round_board
with (security_invoker = true) as
select
  r.id,
  r.org_slug,
  r.key,
  r.job_roles,
  r.title,
  r.purpose,
  r.cadence,
  r.sort_order,
  (select count(*) from staff.round_steps s where s.round_id = r.id)::int
    as step_count,
  last_run.completed_at as last_walked_at,
  last_run.walker       as last_walked_by,
  jsonb_array_length(coalesce(last_run.exceptions, '[]'::jsonb))::int
    as last_exception_count
from staff.rounds r
left join lateral (
  select ru.completed_at, ru.exceptions, u.legal_name as walker
    from staff.round_runs ru
    left join staff.users u on u.id = ru.walked_by
   where ru.round_id = r.id
   order by ru.completed_at desc
   limit 1
) last_run on true
where r.active;

grant select on staff.round_board to staff_app;

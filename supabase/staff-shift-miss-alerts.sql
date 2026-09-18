-- ============================================================
-- ENTIRE-SHIFT MISSES — recorded once, counted per person per year
--
-- staff.overdue_today already tells an owner about ONE unfilled
-- template at a time, and app/api/cron/alerts/route.ts's existing
-- "missed_task" alert deliberately names no one when it fires — see
-- that file's own comment: a missed task is owned by a ROLE, not a
-- named person, and putting a name on "nobody did this" can attribute
-- a failure that may not be theirs.
--
-- This is a different, stricter signal on top of that one: not one
-- gap in an otherwise normal day, but an entire ROLE's entire SLOT —
-- every log that job was supposed to file that shift — coming back
-- completely empty. That is worth naming names for, but only when
-- there are real names to give: a role with nobody rostered for it
-- that day is a staffing gap, not a person's failure, and gets no row
-- here at all (see lib/staff/shift-miss.ts, which is the only writer
-- of this table and enforces that rule before ever inserting).
--
-- ONE ROW PER (org, date, slot, role), EVER. The unique index is what
-- makes the hourly detection idempotent — trying the same insert every
-- hour after a slot closes costs nothing and records the miss exactly
-- once, the same discipline staff_alert_queue_once already uses for
-- excursions.
--
-- person_names HOLDS EVERYONE ROSTERED FOR THAT ROLE THAT DAY, JOINTLY.
-- If two medical assistants were both on duty and the whole shift's
-- logs went unfiled, this counts against both of them rather than
-- guessing which one specifically was responsible — the same "who is
-- actually on the hook" grouping lib/staff/alerts.ts's digestFor()
-- already uses for a shared role's ordinary late tasks.
-- ============================================================

create table if not exists staff.shift_misses (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  work_date date not null,
  slot text not null check (slot in ('am', 'pm')),
  job_role staff.job_role not null,
  -- Preferred/legal name at the moment of the miss, same identity
  -- OnCallStrip.tsx and onDutyToday() already use — not a user id,
  -- because a manual staff.shift_assignments entry has no account to
  -- point one at.
  person_names text[] not null,
  recorded_at timestamptz not null default now(),
  unique (org_slug, work_date, slot, job_role)
);

alter table staff.shift_misses enable row level security;
alter table staff.shift_misses force row level security;

drop policy if exists staff_org_isolation on staff.shift_misses;
create policy staff_org_isolation on staff.shift_misses
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert on staff.shift_misses to staff_app;
-- Never deleted or updated: same reasoning as staff.alert_queue — a
-- record of who was told what, and when a shift genuinely came up
-- empty, is not something a later screen should be able to quietly
-- edit away.
revoke update, delete on staff.shift_misses from staff_app;

-- One more alert kind. The existing check is unnamed, so its
-- Postgres-assigned name follows the standard <table>_<column>_check
-- pattern staff.alert_queue was created under (see staff-alerts.sql).
alter table staff.alert_queue drop constraint if exists alert_queue_kind_check;
alter table staff.alert_queue
  add constraint alert_queue_kind_check
  check (kind in (
    'excursion', 'log', 'missed_task', 'credential_expiry', 'digest', 'missed_shift'
  ));

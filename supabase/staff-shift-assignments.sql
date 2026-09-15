-- ============================================================
-- SHIFT ASSIGNMENTS — one specific date, one specific person
--
-- Not a recurring pattern like staff.users.workdays. An administrator
-- picks an actual date — "9/15/2026" — and types who is covering a job
-- that day. No login, no email, no account required: this is the
-- direct answer to "we don't need placeholders" — a name that persists
-- as its own profile, waiting to be filled, is more structure than the
-- job needs. A slot with nothing assigned just shows nothing. There is
-- no "open" state to model, no separate entity to delete later when a
-- real account replaces it — an administrator either has a name for
-- that date or doesn't.
--
-- SHOWS UP EXACTLY LIKE A REAL ACCOUNT ON THE "ON DUTY TODAY" BANNER.
-- Unlike the placeholder table this replaces, there is no hiding it
-- from that view — the owner was explicit that whoever is actually
-- working today, real login or not, belongs on the one screen every
-- shift already reads to know who's in. See onDutyToday() in
-- lib/staff/roster-today.ts, which merges this table's rows for today
-- alongside staff.users.workdays' own.
--
-- NOT SENT A MORNING HUDDLE, NOT COUNTED IN SEATS, NOT SUBJECT TO ANY
-- OF THE COMPLIANCE MACHINERY. There is no email to send it to and no
-- account to hold a credential or a signed document, so none of that
-- applies — this table exists to answer one question, who's covering
-- this job on this day, and nothing else reads it.
-- ============================================================

create table if not exists staff.shift_assignments (
  id          uuid primary key default gen_random_uuid(),
  org_slug    text not null references staff.orgs(slug) on delete cascade,
  work_date   date not null,
  job_role    staff.job_role not null,
  name        text not null,
  created_by  uuid references staff.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists staff_shift_assignments_date
  on staff.shift_assignments (org_slug, work_date);

alter table staff.shift_assignments enable row level security;
alter table staff.shift_assignments force row level security;
drop policy if exists staff_org_isolation on staff.shift_assignments;
create policy staff_org_isolation on staff.shift_assignments
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, delete on staff.shift_assignments to staff_app;

comment on table staff.shift_assignments is
  'One date, one job, one name — no login required. See the header of staff-shift-assignments.sql. Merged into onDutyToday() for today''s date; who may write is app/api/staff/team/assignment/route.ts''s concern, not RLS''s.';

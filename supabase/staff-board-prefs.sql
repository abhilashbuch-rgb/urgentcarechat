-- ============================================================
-- MY BOARD, MY ORDER
--
-- Run AFTER supabase/staff-logs.sql. Idempotent; safe to re-run.
--
-- THE COMPLAINT THIS ANSWERS. A medical assistant already sees only her
-- own job's tasks — staff.brief_matches() has always scoped that — but
-- every one of them saw them in the same fixed sort_order, on every
-- shift, at every clinic. A real shift doesn't run in that order; it
-- runs in whatever sequence the person doing it has actually settled
-- into, and a board that disagrees with her own rhythm reads as
-- disorganized even when nothing on it is wrong.
--
-- TWO THINGS, DELIBERATELY KEPT SEPARATE FROM WHAT'S OWED.
--   - sort_order lets her put the board in HER order. Purely cosmetic —
--     it changes nothing about which template applies to her job.
--   - hidden lets her collapse something rarely-relevant out of her
--     daily view. It does NOT remove the requirement: todaysBoard()
--     still returns the row, still counts it toward what's outstanding,
--     still flags it if it goes overdue. Hidden means "out of my way
--     today," never "not tracked." A preference that could make a real
--     obligation disappear from the system is the one thing this table
--     is built to be incapable of.
-- ============================================================

create table if not exists staff.log_board_prefs (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  user_id uuid not null references staff.users(id) on delete cascade,
  -- Keyed by slug, not template_id — a template can be edited (its id
  -- changes) without silently resetting everyone's saved order.
  template_slug text not null,
  hidden boolean not null default false,
  -- Null means "no preference yet, use the template's own sort_order."
  sort_order integer,
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_log_board_prefs_once
  on staff.log_board_prefs (user_id, template_slug);

create index if not exists staff_log_board_prefs_org
  on staff.log_board_prefs (org_slug);

alter table staff.log_board_prefs enable row level security;
alter table staff.log_board_prefs force row level security;
drop policy if exists staff_org_isolation on staff.log_board_prefs;
create policy staff_org_isolation on staff.log_board_prefs
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

-- Org isolation is as far as the database goes. "You can only ever
-- write your own preferences, not a colleague's" is enforced in
-- app/api/staff/logs/board-prefs/route.ts instead — every table in
-- this schema is org-scoped, not user-scoped, so a second RLS axis
-- here would be new machinery built for exactly one table.

grant select, insert, update, delete on staff.log_board_prefs to staff_app;

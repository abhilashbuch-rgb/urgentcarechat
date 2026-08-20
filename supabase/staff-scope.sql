-- ============================================================
-- SCOPE OF PRACTICE
--
-- Run AFTER supabase/staff-job-roles.sql (it needs staff.job_role).
-- Idempotent; safe to re-run.
--
-- WHAT THIS IS, AND WHY IT IS NOT A DIRECTIVE
-- -------------------------------------------
-- staff.directives holds standing rules: prose, one rule per row, read
-- and remembered. This holds something narrower and, for the people at
-- the window, more useful — the two lists that answer "is this mine?"
--
--   authorized  — this job may do this, without asking
--   prohibited  — this job may NEVER do this, however busy it is
--
-- Two lists rather than one rule per row because scope is read as a
-- comparison. Somebody covering the desk on their third shift is not
-- looking up a rule; they are looking at a column and checking whether
-- the thing in front of them is in it. Split across two dozen directives
-- that answer is not visible, which in practice means it is not read.
--
-- WHY `instead` IS A COLUMN AND NOT A NICETY
-- A prohibited item with no sanctioned alternative is a rule that gets
-- broken under pressure, because the person still has a patient in front
-- of them wanting an answer. "Never give clinical advice" is not
-- actionable at 11am with a queue; "say: let me get a clinical staff
-- member to answer that, and get one" is. Every prohibited row carries
-- the sentence to use instead, and the seed enforces it.
--
-- SEPARATION. Scope belongs to exactly one job — job_role is a single
-- value here, not the array used on tasks. A task can be shared; a scope
-- boundary cannot be, because the whole point of the row is that it
-- draws a line between one job and another.
-- ============================================================

create table if not exists staff.scope_items (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  -- Stable identifier so the seed can be re-run, and so a clinic that
  -- edits the wording of an item keeps the item.
  key text not null,

  job_role staff.job_role not null,
  kind text not null check (kind in ('authorized', 'prohibited')),

  item text not null,

  -- The sanctioned alternative. Required on prohibited rows by the
  -- constraint below; meaningless on authorized ones.
  instead text,

  -- Where the boundary comes from, when it comes from somewhere. Most of
  -- these are state scope-of-practice law or clinic policy rather than a
  -- federal citation, and a row that cites nothing is honest about being
  -- clinic policy.
  citation text,

  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists staff_scope_items_key
  on staff.scope_items (org_slug, key);

create index if not exists staff_scope_items_role
  on staff.scope_items (org_slug, job_role, kind, sort_order)
  where active;

-- A prohibition with no alternative is a rule that loses to a queue.
-- Enforced here and not only in the seed, because the clinic can add its
-- own rows and the failure mode is identical when they do.
do $$ begin
  alter table staff.scope_items
    add constraint staff_scope_prohibited_needs_alternative
    check (
      kind <> 'prohibited'
      or (instead is not null and length(btrim(instead)) >= 3)
    );
exception when duplicate_object then null;
end $$;

-- An authorized row has nothing to redirect to; a stray `instead` there
-- would render as advice on how to avoid doing your own job.
do $$ begin
  alter table staff.scope_items
    add constraint staff_scope_authorized_has_no_alternative
    check (kind <> 'authorized' or instead is null);
exception when duplicate_object then null;
end $$;

alter table staff.scope_items enable row level security;
alter table staff.scope_items force row level security;

drop policy if exists staff_org_isolation on staff.scope_items;
create policy staff_org_isolation on staff.scope_items
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.scope_items to staff_app;
-- Deactivated, never deleted: which boundaries a clinic decided did not
-- apply to it is exactly the question asked after something goes wrong.
-- staff-schema.sql's ALTER DEFAULT PRIVILEGES grants delete on every
-- future table in this schema, so this table arrived holding it and the
-- GRANT above took none of it away.
revoke delete on staff.scope_items from staff_app;

-- ============================================================
-- THE TWO COLUMNS
--
-- security_invoker so it reads under the caller's org context rather
-- than the view owner's — without it a view over an RLS-protected table
-- returns every org's rows. Same note as staff-onboarding.sql.
--
-- Dropped first rather than CREATE OR REPLACE: replace can only APPEND
-- columns to a view, so a later migration that inserts a column here
-- would make this file's SECOND run fail while its first was clean.
-- ============================================================

drop view if exists staff.scope_of_practice cascade;
create view staff.scope_of_practice
with (security_invoker = true) as
select
  s.id,
  s.org_slug,
  s.key,
  s.job_role,
  s.kind,
  s.item,
  s.instead,
  s.citation,
  s.sort_order
from staff.scope_items s
where s.active;

grant select on staff.scope_of_practice to staff_app;

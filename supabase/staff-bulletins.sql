-- ============================================================
-- CLINIC BULLETINS — one-way notices from whoever runs the building
--
-- Run AFTER supabase/staff-schema.sql and staff-manager-role.sql. Idempotent.
--
-- WHY ONE-WAY. Real internal messaging — two people, or a thread,
-- exchanging replies — is an all-party-consent recording question under
-- Pennsylvania law (18 Pa. C.S. § 5703) the moment the product keeps a
-- copy of the conversation, and that needs an employment attorney's
-- sign-off on the consent flow before it can exist. A posting board is a
-- different thing: one person puts up a notice, everyone reads it, nobody
-- replies inside the product. Same as a printed sheet taped to the break
-- room door — nothing here is a captured conversation between two
-- people, so nothing here raises that question.
--
-- WHO CAN POST is staff.runsClinic() in application terms: an org_admin
-- or manager by ROLE, or the centre admin by JOB — enforced in
-- app/api/staff/bulletins/route.ts, not here. RLS below only confines
-- everything to one org; who may write within that org is, as
-- everywhere else in this schema, the API route's job.
-- ============================================================

create table if not exists staff.bulletins (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  author_id uuid not null references staff.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists staff_bulletins_org_time
  on staff.bulletins (org_slug, created_at desc);

alter table staff.bulletins enable row level security;
alter table staff.bulletins force row level security;
drop policy if exists staff_org_isolation on staff.bulletins;
create policy staff_org_isolation on staff.bulletins
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, delete on staff.bulletins to staff_app;

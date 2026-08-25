-- ============================================================
-- ONE PERSON, WORKING AT MORE THAN ONE OF THE SAME OWNER'S CLINICS
--
-- Run AFTER supabase/staff-multisite.sql. Idempotent.
--
-- staff-multisite.sql solved a different problem: an OWNER administering
-- a second clinic without ever working a shift there, on purpose — see
-- its header. The "administrative identity" row it creates deliberately
-- has no working profile at the second clinic: no shift board, no logs,
-- because an owner clicking into Team at a site they don't staff should
-- not also be handed that site's fridge log to file.
--
-- A MEDICAL ASSISTANT WHO ROTATES BETWEEN THREE OF THE SAME OWNER'S SITES
-- NEEDS THE OPPOSITE: a real, working profile — logs, rounds, her own
-- credentials — at every site she's actually scheduled at.
--
-- WHY NOT ONE IDENTITY ACROSS ALL THREE. staff.users.id is a single
-- global primary key, and nearly everything in this schema — credentials,
-- signed documents, log entries, the audit trail — hangs off that id
-- WITHIN one org's RLS. Making the same id reappear in three orgs' worth
-- of staff.users rows would mean rewriting every foreign key in the
-- schema to a composite key. Not worth it for one rotating employee.
--
-- WHAT THIS BUILDS INSTEAD: three separate staff.users rows — her own
-- account, her own onboarding, her own job at each site (a rotating MA at
-- one clinic can be front desk at another; nothing here assumes the job
-- is the same) — linked by ONE shared person_key so the product can still
-- answer "is this the same person" without pretending they are the same
-- row:
--
--   SIGN-IN. One email, up to three matching accounts. Today that trips
--   staff.resolve_signin()'s ambiguity refusal — deliberately, because a
--   real collision (two unrelated people who happen to share an email
--   pattern) must never have the software guess which org to open. A
--   linked set is not that collision; it is the one case the refusal's
--   own comment says has "no screen for" it yet. This file adds the
--   person_key resolve_signin() already needs to tell the two apart; the
--   picker screen itself is application code, not SQL.
--
--   BILLING. She is one employee, not three — staff.seat_usage is
--   amended so only her HOME row (person_key = id) counts toward a
--   clinic's seat usage; the sites she's linked into see her on the
--   roster but are not billed for her.
--
--   CREDENTIALS. A BLS card doesn't change per building. Linking copies
--   her current ones over so she isn't retyping the same expiry date
--   three times; the new site's onboarding still makes her confirm the
--   JOB and sign that site's OWN policy packet, because those genuinely
--   differ per clinic.
-- ============================================================


-- ---------- 0. The shared key ----------
--
-- Defaults to a row's own id — "home, and the only place this person
-- exists" — for every account that was never linked. Set on INSERT rather
-- than via a column DEFAULT because a default cannot reference the row's
-- own generated id; a BEFORE INSERT trigger can, once the id default has
-- already run.
alter table staff.users
  add column if not exists person_key uuid;

create or replace function staff.users_default_person_key()
returns trigger
language plpgsql
as $$
begin
  if new.person_key is null then
    new.person_key := new.id;
  end if;
  return new;
end $$;

drop trigger if exists staff_users_person_key on staff.users;
create trigger staff_users_person_key
  before insert on staff.users
  for each row execute function staff.users_default_person_key();

-- Backfill: every row that predates this file is its own home.
update staff.users set person_key = id where person_key is null;

alter table staff.users alter column person_key set not null;

create index if not exists staff_users_person_key
  on staff.users (person_key);


-- ---------- 1. resolve_signin() learns to tell "linked" from "collision" ----------
--
-- Same query as staff-multisite.sql's version, with person_key and the
-- clinic's display name added — everything the sign-in picker needs to
-- render without a second cross-org round trip. Still at most 2 rows:
-- the caller does not need every clinic here, only enough to know
-- whether there is more than one and, if so, whether they are the same
-- person wearing two badges or a genuine ambiguity to refuse.
--
-- For three or more linked sites the picker still needs the full list —
-- staff.list_my_orgs_for_person() below is what it calls once it knows
-- this is a linked account, not a collision.
create or replace function staff.resolve_signin(p_email text, p_google_sub text)
returns table (
  org_slug text,
  member_role staff.user_role,
  existing boolean,
  person_key uuid,
  org_name text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select u.org_slug, u.role, true, u.person_key, o.name
    from staff.users u
    join staff.orgs o on o.slug = u.org_slug
   where u.active
     and not u.reachable_via_switch
     and (u.google_sub = p_google_sub or lower(u.email) = lower(p_email))
   limit 2
$$;

revoke all on function staff.resolve_signin(text, text) from public;
grant execute on function staff.resolve_signin(text, text) to staff_app;

-- Every clinic a linked person can sign into directly — not the switcher
-- (staff.list_my_orgs(), which is for an owner's administrative reach),
-- this is her own working accounts. Called once resolve_signin() has
-- already established the match is a linked person, not a collision.
create or replace function staff.list_my_orgs_for_person(p_person_key uuid)
returns table (org_slug text, org_name text, member_role staff.user_role)
language sql stable
security definer
set search_path = pg_catalog, public
as $$
  select u.org_slug, o.name, u.role
    from staff.users u
    join staff.orgs o on o.slug = u.org_slug
   where u.person_key = p_person_key
     and u.active
     and not u.reachable_via_switch
   order by o.name
$$;

revoke all on function staff.list_my_orgs_for_person(uuid) from public;
grant execute on function staff.list_my_orgs_for_person(uuid) to staff_app;


-- ---------- 2. Adding an existing person to another of the owner's sites ----------
--
-- NOT an invite. She already proved who she is at her home clinic; this
-- is the owner (or an admin at the target site) vouching that the same
-- person also works here — the same trust an owner already has to
-- administer a second clinic in the first place. So no email, no link to
-- click: she simply sees the new clinic next time she signs in.
--
-- SAME GROUP ONLY. Linking across staff.orgs.group_id is the whole
-- safety boundary here — it is exactly the set of clinics one owner
-- already controls, the same boundary staff.add_clinic() trusts for
-- letting an owner reach a second clinic as its administrator. Linking a
-- person into an org outside that group would let one clinic's admin
-- reach into a stranger's roster by guessing a user id, so it is refused
-- outright rather than left to the caller to check.
create or replace function staff.link_existing_person(
  p_home_user_id uuid,
  p_target_org text,
  p_job_role staff.job_role,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  home record;
  target_group uuid;
  new_id uuid;
begin
  select u.id, u.person_key, u.email, u.name, u.legal_name, u.phone, o.group_id
    into home
    from staff.users u
    join staff.orgs o on o.slug = u.org_slug
   where u.id = p_home_user_id
     and u.active
     and u.person_key = u.id  -- must be linking FROM a home row
   for update of u;

  if home.id is null then
    raise exception 'not_a_home_account' using errcode = 'invalid_parameter_value';
  end if;

  select group_id into target_group from staff.orgs where slug = p_target_org;

  if target_group is null or home.group_id is null
     or target_group <> home.group_id then
    raise exception 'not_same_group' using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from staff.users
     where org_slug = p_target_org
       and person_key = home.person_key
       and active
  ) then
    raise exception 'already_linked' using errcode = 'unique_violation';
  end if;

  insert into staff.users
    (org_slug, email, name, legal_name, phone, role, job_role, person_key)
  values
    (p_target_org, home.email, home.name, home.legal_name, home.phone,
     'staff', p_job_role, home.person_key)
  returning id into new_id;

  -- Carried over so she is not retyping a card she already handed her
  -- home clinic. job_confirmed_at and esign_consented_at are deliberately
  -- NOT copied — the job can differ site to site, and this clinic's own
  -- policy packet still gets its own real signature.
  insert into staff.credentials (org_slug, user_id, kind, expires_on)
  select p_target_org, new_id, kind, expires_on
    from staff.credentials
   where user_id = p_home_user_id
     and active
     and expires_on is not null;

  insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
  values (p_target_org, p_actor_id, 'person_linked', 'user', new_id,
          jsonb_build_object('home_user_id', p_home_user_id, 'job_role', p_job_role));

  return new_id;
end $$;

revoke all on function staff.link_existing_person(uuid, text, staff.job_role, uuid) from public;
grant execute on function staff.link_existing_person(uuid, text, staff.job_role, uuid) to staff_app;


-- ---------- 3. Seats: billed once, at home, not once per site ----------
--
-- Identical to staff-seats.sql's view except every count(u.id) filter
-- also requires person_key = id — a linked (non-home) row still shows up
-- on that clinic's roster, still shows up in staff.pending_invites-style
-- team management, just does not add to what the clinic is charged for.
drop view if exists staff.seat_usage cascade;
create view staff.seat_usage
with (security_invoker = true)
as
select
  o.slug                                             as org_slug,
  r.job_role,
  coalesce(ov.included, ps.included, 0)              as included,
  coalesce(ov.included, ps.included, 0) is distinct from ps.included
                                                     as is_override,
  count(u.id) filter (where u.active and u.person_key = u.id) as in_use,
  count(distinct i.id) filter (
    where i.revoked_at is null
      and i.accepted_at is null
      and not exists (
        select 1 from staff.users x
         where x.org_slug = o.slug
           and lower(x.email) = lower(i.email)
           and x.active
      )
  )                                                  as invited_not_yet_in,
  greatest(
    count(u.id) filter (where u.active and u.person_key = u.id)
      - coalesce(ov.included, ps.included, 0),
    0
  )                                                  as over_by,
  coalesce(ps.extra_seat_cents, 0)                   as extra_seat_cents,
  greatest(
    count(u.id) filter (where u.active and u.person_key = u.id)
      - coalesce(ov.included, ps.included, 0),
    0
  ) * coalesce(ps.extra_seat_cents, 0)               as extra_cents
from staff.orgs o
cross join unnest(enum_range(null::staff.job_role)) as r(job_role)
left join staff.plan_seats ps
       on ps.plan = o.plan and ps.job_role = r.job_role
left join staff.org_seat_overrides ov
       on ov.org_slug = o.slug and ov.job_role = r.job_role
left join staff.users u
       on u.org_slug = o.slug and u.job_role = r.job_role
left join staff.org_invites i
       on i.org_slug = o.slug and i.job_role = r.job_role
where not o.is_library
group by o.slug, r.job_role, ov.included, ps.included, ps.extra_seat_cents;

grant select on staff.seat_usage to staff_app;


-- ---------- 4. Deactivating her HOME account closes every linked door ----------
--
-- Same idiom as staff.revoke_invites_on_deactivate() in staff-invites.sql
-- — a trigger, because there is more than one route to active = false
-- and the one that forgets is the one that matters.
--
-- ONE DIRECTION ONLY. Deactivating her at a site she's LINKED into (she
-- stopped rotating there, or was let go from just that location) says
-- nothing about her home clinic or any other linked one — she may still
-- work both. Deactivating her HOME account is different: that is the
-- owner ending the employment relationship this whole group was built
-- on, and an owner who does that while her accounts at two of THEIR OWN
-- other clinics stay live has a real gap, not a choice they made on
-- purpose.
create or replace function staff.deactivate_cascades_from_home()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.active and not new.active and old.person_key = old.id then
    update staff.users
       set active = false, session_epoch = session_epoch + 1
     where person_key = old.person_key
       and id <> old.id
       and active;
  end if;
  return new;
end $$;

drop trigger if exists staff_users_deactivate_cascades_from_home on staff.users;
create trigger staff_users_deactivate_cascades_from_home
  after update of active on staff.users
  for each row
  execute function staff.deactivate_cascades_from_home();

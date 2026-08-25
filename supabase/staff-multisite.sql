-- ============================================================
-- MULTI-SITE, FINISHED: PRICE THE CLINIC, NOT THE PERSON, AND LET
-- SOMEBODY ACTUALLY REACH THE SECOND ONE
--
-- Run AFTER supabase/staff-facility.sql. Idempotent.
--
-- staff-facility.sql built staff.org_groups, staff.user_orgs and
-- staff.add_clinic() — the data model for an owner who runs more than
-- one site. Nothing in the app ever called any of it. This file finishes
-- the job: fixes the one thing add_clinic() got wrong, and adds the two
-- functions the application layer needs that did not exist yet.
--
-- ---------------------------------------------------------------
-- BUG: A SECOND CLINIC WAS FREE
-- ---------------------------------------------------------------
-- add_clinic() copied plan, subscription_status and is_read_only straight
-- from the home clinic. An owner already paying and active would have
-- their new clinic created already-active — no charge, ever, for as many
-- clinics as they cared to add. The landing page has always said
-- otherwise: "$149/clinic/month... no volume discount... Groups are
-- handled by adding clinics, each at the same price."
--
-- Fixed the same way a brand-new signup is priced: the new clinic gets
-- its own 30-day trial, same as provision_trial(). No new billing
-- mechanism needed — staff.org_is_read_only() already flips a trial to
-- read-only on read once trial_ends_on passes, and the Stripe webhook
-- (app/api/webhooks/stripe/route.ts) already accepts a Payment Link
-- completion carrying client_reference_id for an EXISTING org slug,
-- specifically so "an existing clinic adding a location" attaches a
-- subscription to the clinic just created rather than provisioning a
-- third one. That comment predates this file; this is what it was
-- waiting for.
-- ---------------------------------------------------------------
-- BUG: A GRANT WITH NO ROW BEHIND IT
-- ---------------------------------------------------------------
-- staff.user_orgs grants access; it does not create staff.users row in
-- the new org. But almost everything else in this schema — a profile, a
-- credential, a signed document, the onboarding gates, an audit log
-- entry — is keyed to a user_id THAT LIVES IN THAT ORG under RLS. An
-- owner who switched in on the grant alone had a role and nothing to
-- attach it to: /staff read their profile as "does not exist" and sent
-- them straight into onboarding, for a clinic they may never work a
-- shift at.
--
-- staff.users gets a row for them too now — reachable_via_switch (below)
-- marks it as what it is: an administrative identity, not a place to
-- sign in directly.
--
-- WHY NOT JUST A SECOND EMAIL MATCH. staff.resolve_signin() is the one
-- function a Google or emailed-code sign-in trusts to say which org an
-- address belongs to, and it refuses outright the moment an email
-- matches staff.users in two orgs — deliberately, because picking one
-- for a real ambiguous case would be a security bug, not a convenience.
-- A second row with the same email would trip that refusal for every
-- multi-site owner trying to sign in normally, which is the opposite of
-- what this feature is for. reachable_via_switch excludes exactly this
-- row from that lookup: direct sign-in still resolves to one org, the
-- home one, unchanged for every existing user; the second clinic is only
-- ever reached through the in-app switcher, which does not go through
-- resolve_signin at all.
-- ---------------------------------------------------------------
-- BUG: THE SESSION LAYER HAD NO CONCEPT OF A SECOND CLINIC
-- ---------------------------------------------------------------
-- Every request re-validates the session against staff.users.org_slug —
-- the person's ONE home clinic — and refuses ("revoked") on any mismatch.
-- staff.user_orgs granting access to a second clinic changed nothing
-- there: the moment a session's org claim named the second clinic, the
-- live check would kick it straight back out.
--
-- staff.session_check_for() below is the fix: given a user and a
-- candidate org, it returns the role that applies there — the home role
-- if it's the home clinic, the granted role from user_orgs if it's a
-- second one, or no row at all if neither, which is a plain "no". Called
-- instead of the org-blind staff.session_checks view.
-- ---------------------------------------------------------------
-- BUG: staff.my_orgs COULD NOT ACTUALLY LIST A SECOND CLINIC
-- ---------------------------------------------------------------
-- staff.my_orgs is a plain view (security_invoker), and its join to
-- staff.orgs is subject to that table's own RLS policy — "your org, or
-- you are the platform super admin" — which only ever allows ONE org at
-- a time. Queried from inside any single clinic's request, the join
-- silently drops every other clinic's row. It was never wrong so much as
-- untestable from the one context the app ever runs a query in.
--
-- staff.list_my_orgs() replaces it for the switcher UI: a SECURITY
-- DEFINER function, same bootstrap pattern as staff.resolve_signin() —
-- it is the one place allowed to look across orgs, and it returns
-- nothing but the rows a switcher screen needs.
-- ============================================================


-- ---------- 0. The administrative-identity marker ----------

alter table staff.users
  add column if not exists reachable_via_switch boolean not null default false;

-- Redefined only to add "and not reachable_via_switch" — everything else
-- is unchanged from staff-single-domain.sql. Direct sign-in still
-- resolves to exactly the rows it always did for every account that has
-- never touched multi-site; an administrative identity row from
-- add_clinic() is the one new kind of row this now has to skip, because
-- it exists to be reached by the in-app switcher, not by Google or an
-- emailed code.
create or replace function staff.resolve_signin(p_email text, p_google_sub text)
returns table (org_slug text, member_role staff.user_role, existing boolean)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select u.org_slug, u.role, true
    from staff.users u
   where u.active
     and not u.reachable_via_switch
     and (u.google_sub = p_google_sub or lower(u.email) = lower(p_email))
   limit 2
$$;

revoke all on function staff.resolve_signin(text, text) from public;
grant execute on function staff.resolve_signin(text, text) to staff_app;


-- ---------- 1. A second clinic starts on its own trial ----------

create or replace function staff.add_clinic(
  p_owner_email text, p_slug text, p_name text, p_facility text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  home_slug text;
  home_group uuid;
  final_slug text;
  n int := 1;
  owner_id uuid;
  owner_name text;
  owner_legal_name text;
  home_billing_email text;
begin
  select u.org_slug, u.id, u.name, u.legal_name
    into home_slug, owner_id, owner_name, owner_legal_name
    from staff.users u
   where lower(u.email) = lower(p_owner_email)
     and u.role in ('org_admin', 'platform_super_admin')
     and u.active
   limit 1;
  if home_slug is null then
    raise exception 'no owning account for %', p_owner_email
      using errcode = 'insufficient_privilege';
  end if;

  final_slug := p_slug;
  while exists (select 1 from staff.orgs where slug = final_slug) loop
    n := n + 1;
    final_slug := p_slug || '-' || n;
  end loop;

  select group_id into home_group from staff.orgs where slug = home_slug;
  if home_group is null then
    insert into staff.org_groups (name)
    select coalesce(o.name, home_slug) from staff.orgs o where o.slug = home_slug
    returning id into home_group;
    update staff.orgs set group_id = home_group where slug = home_slug;
  end if;

  select billing_email into home_billing_email
    from staff.orgs where slug = home_slug;

  -- OWN TRIAL, NOT THE HOME CLINIC'S LIVE STATE. plan/subscription_status
  -- /is_read_only/trial_ends_on are the four columns that decide whether
  -- a clinic can file — this is the fix, not a detail of it.
  insert into staff.orgs (slug, name, plan, subscription_status, is_read_only,
                          trial_ends_on, billing_email, facility_type, group_id)
  values (final_slug, p_name, 'trial', 'trialing', false,
          current_date + 30, home_billing_email,
          coalesce(p_facility, 'urgent_care'), home_group);

  -- The owner reaches the new clinic as an administrator; their home org
  -- is unchanged, so their session still opens where it always did.
  insert into staff.user_orgs (user_id, org_slug, role, granted_by)
  values (owner_id, final_slug, 'org_admin', owner_id)
  on conflict do nothing;

  -- The administrative identity itself (see the note above this
  -- function). reachable_via_switch = true keeps it out of
  -- staff.resolve_signin() — this person still only ever signs in
  -- directly at their home clinic. Name and legal name are carried over
  -- so the profile step, if they're later invited to actually work a
  -- shift here, is not asking a stranger's question of someone who
  -- already answered it once; job_role/job_confirmed_at are left unset
  -- deliberately, same as staff-founder-job.sql — center_admin fits, but
  -- they still see and click the real confirmation screen for THIS
  -- clinic rather than having it silently assumed.
  -- No ON CONFLICT clause: final_slug was just proven not to exist above,
  -- so (email, org_slug) cannot already have a row.
  insert into staff.users (org_slug, email, name, role, job_role, legal_name,
                           reachable_via_switch)
  values (final_slug, lower(p_owner_email), owner_name, 'org_admin',
          'center_admin', owner_legal_name, true);

  insert into staff.org_invites (org_slug, email, role)
  values (final_slug, lower(p_owner_email), 'org_admin')
  on conflict do nothing;

  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.add_clinic(text, text, text, text) from public;
grant execute on function staff.add_clinic(text, text, text, text) to staff_app;


-- ---------- 2. Which role a person holds in a GIVEN clinic ----------

-- The org-aware replacement for staff.session_checks. Returns one row —
-- home clinic or a granted one — or none at all, which is the correct
-- "no" for a clinic this person cannot reach. active/session_epoch/
-- mfa_enrolled live on the person, not the clinic, so they are the same
-- either way; role is the one thing that actually depends on which
-- clinic was asked about.
create or replace function staff.session_check_for(p_uid uuid, p_org text)
returns table (
  active boolean,
  role staff.user_role,
  session_epoch integer,
  mfa_enrolled boolean
)
language sql stable
security definer
set search_path = pg_catalog, public
as $$
  select u.active,
         case when u.org_slug = p_org then u.role else m.role end,
         u.session_epoch,
         (u.totp_confirmed_at is not null)
    from staff.users u
    left join staff.user_orgs m
      on m.user_id = u.id and m.org_slug = p_org
   where u.id = p_uid
     and (u.org_slug = p_org or m.org_slug is not null)
   limit 1
$$;

revoke all on function staff.session_check_for(uuid, text) from public;
grant execute on function staff.session_check_for(uuid, text) to staff_app;


-- ---------- 3. Every clinic a person can reach, for the switcher ----------

create or replace function staff.list_my_orgs(p_uid uuid)
returns table (
  slug text,
  name text,
  facility_type text,
  member_role staff.user_role,
  is_home boolean,
  subscription_status text,
  is_read_only boolean,
  trial_ends_on date
)
language sql stable
security definer
set search_path = pg_catalog, public
as $$
  select o.slug, o.name, o.facility_type, u.role, true,
         o.subscription_status, o.is_read_only, o.trial_ends_on
    from staff.users u
    join staff.orgs o on o.slug = u.org_slug
   where u.id = p_uid and u.active
  union
  select o.slug, o.name, o.facility_type, m.role, false,
         o.subscription_status, o.is_read_only, o.trial_ends_on
    from staff.user_orgs m
    join staff.orgs o on o.slug = m.org_slug
   where m.user_id = p_uid
$$;

revoke all on function staff.list_my_orgs(uuid) from public;
grant execute on function staff.list_my_orgs(uuid) to staff_app;

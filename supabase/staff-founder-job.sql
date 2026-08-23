-- ============================================================
-- THE PERSON PAYING FOR IT IS THE ADMIN — NOT AN OPEN QUESTION
--
-- staff.provision_trial and staff.provision_org each write the founding
-- administrator's invite with role = 'org_admin' and nothing else. Every
-- OTHER invite in this product carries a job_role, chosen by whoever
-- issues it (see the Team screen's invite form) — the founder's invite
-- is the one exception, and it is an omission rather than a decision.
--
-- THE CONSEQUENCE WAS A DEAD END, not a cosmetic gap. Onboarding's job
-- step (staff-onboarding-wizard.sql) treats job_role is null as
-- job_unassigned and renders: "Your invite didn't say what you do here.
-- Ask whoever invited you to set your job." For a founder there is no
-- whoever — they invited themselves by paying — so the very first
-- person to ever use a clinic hit a wall with no door in it.
--
-- THE FIX IS DATA, NOT A NEW SCREEN. There is no "owner" value in
-- staff.job_role, and there does not need to be: the founder runs the
-- building, which is what center_admin already means, and the seat
-- table already reserves three free center_admin seats per plan. They
-- now go through the exact same JobConfirm step as anyone else —
-- "You were invited as Center admin", the same scope-of-practice lines,
-- the same confirm button. Not a special case; the general case,
-- correctly populated.
-- ============================================================

create or replace function staff.provision_trial(
  p_slug text, p_name text, p_email text, p_days int default 14,
  p_facility text default 'urgent_care'
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare final_slug text; n int := 1;
begin
  select org_slug into final_slug
    from staff.org_invites where lower(email) = lower(p_email) limit 1;
  if found then return final_slug; end if;

  final_slug := p_slug;
  while exists (select 1 from staff.orgs where slug = final_slug) loop
    n := n + 1;
    final_slug := p_slug || '-' || n;
  end loop;

  insert into staff.orgs (slug, name, plan, subscription_status,
                          is_read_only, trial_ends_on, billing_email,
                          facility_type)
  values (final_slug, p_name, 'trial', 'trialing',
          false, current_date + p_days, lower(p_email),
          coalesce(p_facility, 'urgent_care'));

  insert into staff.org_invites (org_slug, email, role, job_role)
  values (final_slug, lower(p_email), 'org_admin', 'center_admin');

  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

create or replace function staff.provision_org(
  p_slug text, p_name text, p_customer text, p_subscription text, p_email text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare final_slug text; n int := 1;
begin
  select slug into final_slug from staff.orgs
   where stripe_customer_id = p_customer limit 1;
  if found then return final_slug; end if;

  final_slug := p_slug;
  while exists (select 1 from staff.orgs where slug = final_slug) loop
    n := n + 1;
    final_slug := p_slug || '-' || n;
  end loop;

  insert into staff.orgs (slug, name, plan, stripe_customer_id,
                          stripe_subscription_id, subscription_status,
                          is_read_only, billing_email, facility_type)
  values (final_slug, p_name, 'stripe', p_customer, p_subscription,
          'active', false, p_email, 'urgent_care');

  -- The person who paid is the first administrator, and their job here
  -- is running the building.
  insert into staff.org_invites (org_slug, email, role, job_role)
  values (final_slug, lower(p_email), 'org_admin', 'center_admin');

  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.provision_org(text, text, text, text, text) from public;
grant execute on function staff.provision_org(text, text, text, text, text) to staff_app;
revoke all on function staff.provision_trial(text, text, text, int, text) from public;
grant execute on function staff.provision_trial(text, text, text, int, text) to staff_app;


-- ---------- Repair anyone already caught by the gap ----------
--
-- An org_admin whose job_role is still null is, unambiguously, a founder
-- provisioned before this fix — nobody has ever had a UI to set it to
-- anything else, so there is no intentional value to overwrite.
--
-- job_confirmed_at is deliberately left untouched. The point of the job
-- step is the confirmation itself, not just the data behind it — the
-- founder should still see "You were invited as Center admin" and click
-- it, the same as every other job holder, not be silently walked past
-- their own onboarding.
update staff.org_invites
   set job_role = 'center_admin'
 where role = 'org_admin'
   and job_role is null
   and accepted_at is null
   and revoked_at is null;

update staff.users
   set job_role = 'center_admin'
 where role = 'org_admin'
   and job_role is null;

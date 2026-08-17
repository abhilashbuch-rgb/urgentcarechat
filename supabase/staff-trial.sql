-- ============================================================
-- NO-CREDIT-CARD TRIALS
--
-- Run AFTER supabase/staff-billing.sql. Idempotent.
--
-- "Start a 14-day trial, no credit card" is the conversion mechanism, and
-- it needs an org to exist BEFORE Stripe has ever heard of the customer.
--
-- Expiry is COMPUTED, NOT SCHEDULED. A nightly job that flips expired
-- trials to read-only is a job that can fail silently and hand out free
-- months, or fire twice and read-only somebody who just paid. A trial is
-- over when the date says so, evaluated on read.
-- ============================================================

alter table staff.orgs add column if not exists trial_ends_on date;

-- The single source of truth for "can this clinic file new entries".
-- is_read_only covers billing state; this adds the trial clock. Used by
-- the trigger and by the UI so they cannot disagree.
create or replace function staff.org_is_read_only(p_slug text)
returns boolean
language sql stable as $$
  select coalesce(
    o.is_read_only
    or (o.subscription_status = 'trialing'
        and o.trial_ends_on is not null
        and o.trial_ends_on < current_date),
    false)
  from staff.orgs o where o.slug = p_slug
$$;

-- Repoint the gate at it. Same trigger, same table, one definition of the
-- rule now instead of two.
create or replace function staff.reject_when_read_only()
returns trigger language plpgsql as $$
begin
  if staff.org_is_read_only(new.org_slug) then
    raise exception 'read_only: % is in read-only mode; existing records stay readable and exportable', new.org_slug
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Provisioning a trial, before any org context exists — same bootstrap
-- problem and same narrow SECURITY DEFINER treatment as provision_org.
--
-- One trial per email, ever. Not airtight against someone with many
-- addresses, and not meant to be: the cost of a spare empty org is a row,
-- and anything stricter would block a real clinic whose manager typo'd
-- their address the first time.
create or replace function staff.provision_trial(
  p_slug text, p_name text, p_email text, p_days int default 14
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
                          is_read_only, trial_ends_on, billing_email)
  values (final_slug, p_name, 'trial', 'trialing',
          false, current_date + p_days, lower(p_email));

  insert into staff.org_invites (org_slug, email, role)
  values (final_slug, lower(p_email), 'org_admin');

  return final_slug;
end $$;

revoke all on function staff.provision_trial(text, text, text, int) from public;
grant execute on function staff.provision_trial(text, text, text, int) to staff_app;
grant execute on function staff.org_is_read_only(text) to staff_app;

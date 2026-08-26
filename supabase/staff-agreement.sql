-- ============================================================
-- THE SUBSCRIPTION AGREEMENT, ACCEPTED AND RECORDED
--
-- Run AFTER supabase/staff-founder-job.sql. Idempotent.
--
-- Every record this product asks a clinic to trust exists because
-- someone did something and it was written down, not because a
-- checkbox was rendered on a screen. A signup flow that shows an "I
-- agree" box and never records that it was checked is exactly the
-- hollow record this product exists to replace elsewhere in the
-- building — nothing to point to, a year later, when the question is
-- whether an owner actually agreed to the geolocation terms in
-- app/agreement/page.tsx before signing up.
--
-- WHAT THIS ADDS: one timestamp, staff.orgs.agreement_accepted_at, set
-- once at signup and never touched again — provenance, the same
-- contract every other timestamp in this schema keeps. And the check is
-- enforced in staff.provision_trial() itself, not just trusted from the
-- client: a request that reaches this function without acceptance gets
-- no organization, the same posture every other guard in this schema
-- takes toward a caller that could otherwise route around it.
-- ============================================================

alter table staff.orgs
  add column if not exists agreement_accepted_at timestamptz;

-- DROP FIRST, MATCHING THE IDIOM ALREADY ESTABLISHED IN THIS SCHEMA (see
-- the comment on this exact function in staff-facility.sql): adding a
-- required argument changes the signature, and CREATE OR REPLACE only
-- replaces a function with the SAME signature — it does not overload.
drop function if exists staff.provision_trial(text, text, text, int, text);

create or replace function staff.provision_trial(
  p_slug text, p_name text, p_email text, p_days int default 30,
  p_facility text default 'urgent_care', p_agreed boolean default false
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

  -- Enforced here, not only checked on the client. THE ROUTE ALSO
  -- REJECTS AN UNAGREED REQUEST BEFORE IT REACHES THIS FUNCTION (see
  -- app/api/trial/route.ts) so a visitor sees a clean 400 rather than
  -- this exception — this guard exists for whatever calls
  -- provision_trial without going through that route.
  if not coalesce(p_agreed, false) then
    raise exception 'subscription agreement not accepted'
      using errcode = 'check_violation';
  end if;

  final_slug := p_slug;
  while exists (select 1 from staff.orgs where slug = final_slug) loop
    n := n + 1;
    final_slug := p_slug || '-' || n;
  end loop;

  insert into staff.orgs (slug, name, plan, subscription_status,
                          is_read_only, trial_ends_on, billing_email,
                          facility_type, agreement_accepted_at)
  values (final_slug, p_name, 'trial', 'trialing',
          false, current_date + p_days, lower(p_email),
          coalesce(p_facility, 'urgent_care'), now());

  insert into staff.org_invites (org_slug, email, role, job_role)
  values (final_slug, lower(p_email), 'org_admin', 'center_admin');

  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.provision_trial(text, text, text, int, text, boolean) from public;
grant execute on function staff.provision_trial(text, text, text, int, text, boolean) to staff_app;


-- ---------- Clinics that signed up before this existed ----------
--
-- Every org already provisioned agreed to nothing in writing, because
-- there was nothing to agree to. Backfilling agreement_accepted_at with
-- a fabricated date would misstate history; leaving it null is the
-- honest record of "this predates the agreement flow," and is exactly
-- the distinction a real audit would need to draw anyway.

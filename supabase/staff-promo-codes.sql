-- ============================================================
-- PROMO CODES: A LONGER TRIAL FOR WHOEVER HAS ONE
--
-- Run AFTER supabase/staff-agreement.sql. Idempotent.
--
-- ONE CODE CAN BE POSTED PUBLICLY. A code meant for an Instagram caption
-- is not a secret and is not meant to be redeemed once — max_uses is
-- nullable (null = unlimited) precisely so a single, memorable code can
-- be handed to however many people see the post, capped only if the
-- owner wants a ceiling.
--
-- A BAD CODE NEVER SILENTLY BECOMES A PLAIN TRIAL. See the rewritten
-- staff.provision_trial() below and app/api/trial/route.ts: an
-- unknown, expired, exhausted or inactive code refuses the signup with
-- a specific error the visitor can act on, rather than quietly
-- granting 30 days to someone who believes they typed their way into
-- 90 — the same "an unverifiable claim is worse than an obvious
-- refusal" posture this schema takes everywhere else.
--
-- NO ADMIN SCREEN, ON PURPOSE. One person mints these today, rarely.
-- Building a console for that is solving a problem this product does
-- not have yet — a code is one INSERT, run by hand, same as any other
-- one-off operational change to this schema.
-- ============================================================

create table if not exists staff.promo_codes (
  code text primary key,
  trial_days integer not null check (trial_days > 0 and trial_days <= 365),
  -- Null means no ceiling — the shape a code meant for a public post
  -- needs, since nobody can say in advance how many people will see it.
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0,
  expires_on date,
  active boolean not null default true,
  -- Internal only, never shown to a visitor — "Instagram launch",
  -- "Jamie's referral" — so a list of codes reads as something a
  -- person can manage rather than a table of bare strings.
  label text,
  created_at timestamptz not null default now()
);

-- Typed on a phone from a caption. Case is never the reason one fails.
create unique index if not exists staff_promo_codes_ci
  on staff.promo_codes (upper(code));

-- Redeems atomically: the UPDATE's own WHERE clause IS the capacity
-- check, so two people redeeming the last remaining use at the same
-- instant cannot both succeed — Postgres serializes the two UPDATEs
-- against the same row, and whichever runs second sees used_count
-- already at the cap. Returns the trial length granted, or null for
-- any reason the code did not apply (unknown, inactive, expired,
-- exhausted) — the caller decides what null means; this function only
-- ever reports what happened. SECURITY DEFINER for the same reason as
-- provision_trial itself: called from the unauthenticated signup
-- route, before any session or org context exists.
create or replace function staff.redeem_promo_code(p_code text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_days integer;
begin
  update staff.promo_codes
     set used_count = used_count + 1
   where upper(code) = upper(btrim(p_code))
     and active
     and (expires_on is null or expires_on >= current_date)
     and (max_uses is null or used_count < max_uses)
  returning trial_days into v_days;

  return v_days;
end $$;

revoke all on function staff.redeem_promo_code(text) from public;
grant execute on function staff.redeem_promo_code(text) to staff_app;

-- Not org-scoped — a code exists before any org does, same reason
-- staff.stripe_events isn't. Locked to a platform admin: staff_app's
-- ordinary session context (any clinic's own role) has no business
-- reading or writing this table directly, only through
-- redeem_promo_code()'s own SECURITY DEFINER path above.
alter table staff.promo_codes enable row level security;
alter table staff.promo_codes force row level security;
drop policy if exists staff_promo_codes_admin_only on staff.promo_codes;
create policy staff_promo_codes_admin_only on staff.promo_codes
  for all using (staff.is_super_admin()) with check (staff.is_super_admin());

grant select, insert, update on staff.promo_codes to staff_app;
revoke delete on staff.promo_codes from staff_app;

-- DROP FIRST, MATCHING THE IDIOM ALREADY ESTABLISHED IN THIS SCHEMA
-- (see the comment on this exact function in staff-agreement.sql):
-- adding a new argument changes the signature, and CREATE OR REPLACE
-- only replaces a function with the SAME signature — it does not
-- overload.
drop function if exists staff.provision_trial(text, text, text, int, text, boolean);

create or replace function staff.provision_trial(
  p_slug text, p_name text, p_email text, p_days int default 30,
  p_facility text default 'urgent_care', p_agreed boolean default false,
  p_code text default null
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare final_slug text; n int := 1; v_days int := p_days;
begin
  select org_slug into final_slug
    from staff.org_invites where lower(email) = lower(p_email) limit 1;
  if found then return final_slug; end if;

  -- Enforced here, not only checked on the client — see the comment on
  -- this same guard further down and in app/api/trial/route.ts.
  if not coalesce(p_agreed, false) then
    raise exception 'subscription agreement not accepted'
      using errcode = 'check_violation';
  end if;

  -- A CODE THAT DOES NOT APPLY REFUSES THE SIGNUP RATHER THAN QUIETLY
  -- GRANTING THE PLAIN TRIAL. See the header on this file for why.
  -- Message prefix matched by app/api/trial/route.ts, same idiom as
  -- the 'read_only:' prefix staff.reject_when_read_only() raises.
  if p_code is not null and btrim(p_code) <> '' then
    select staff.redeem_promo_code(p_code) into v_days;
    if v_days is null then
      raise exception 'invalid_promo_code: % is not a working code', p_code
        using errcode = 'no_data_found';
    end if;
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
          false, current_date + v_days, lower(p_email),
          coalesce(p_facility, 'urgent_care'), now());

  insert into staff.org_invites (org_slug, email, role, job_role)
  values (final_slug, lower(p_email), 'org_admin', 'center_admin');

  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.provision_trial(text, text, text, int, text, boolean, text) from public;
grant execute on function staff.provision_trial(text, text, text, int, text, boolean, text) to staff_app;

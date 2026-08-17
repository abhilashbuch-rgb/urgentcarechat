-- ============================================================
-- BILLING, AND THE REGULATORY IDENTITY OF A CLINIC
--
-- Run AFTER supabase/staff-single-domain.sql. Idempotent.
--
-- THE RULE THAT SHAPES THIS FILE: a lapsed subscription must never lock a
-- clinic out of its own compliance records. Those records are the
-- evidence they produce for a surveyor. Turning a billing hiccup into
-- "we couldn't produce our logs" would make this product the cause of the
-- exact catastrophe it is sold to prevent.
--
-- So non-payment is READ-ONLY, not lockout: everything already recorded
-- stays readable and exportable forever; only new operational entries
-- stop. That is enough commercial pressure — a clinic that cannot run
-- today's shift will notice — without ever holding their evidence hostage.
-- ============================================================

alter table staff.orgs add column if not exists stripe_customer_id     text;
alter table staff.orgs add column if not exists stripe_subscription_id text;
-- Mirrors Stripe's own vocabulary so the value is diffable against the
-- dashboard when something looks wrong: active | trialing | past_due |
-- canceled | unpaid | incomplete.
alter table staff.orgs add column if not exists subscription_status text not null default 'active';
alter table staff.orgs add column if not exists is_read_only boolean not null default false;
alter table staff.orgs add column if not exists billing_email text;
alter table staff.orgs add column if not exists read_only_since timestamptz;

create unique index if not exists staff_orgs_stripe_customer
  on staff.orgs (stripe_customer_id) where stripe_customer_id is not null;

-- ---------- regulatory identity ----------
--
-- Deliberately on staff.orgs and NOT on public.tenants. public.tenants
-- decides what colour a clinic's patient chat bubbles are; this is their
-- CLIA certificate. Mixing the two would put regulatory identifiers in the
-- table the anonymous patient side reads.
alter table staff.orgs add column if not exists site_id               text;
alter table staff.orgs add column if not exists legal_entity          text;
alter table staff.orgs add column if not exists address_line1         text;
alter table staff.orgs add column if not exists city                  text;
alter table staff.orgs add column if not exists state                 text;
alter table staff.orgs add column if not exists postal_code           text;
alter table staff.orgs add column if not exists phone                 text;
alter table staff.orgs add column if not exists clia_number           text;
alter table staff.orgs add column if not exists pa_dep_number         text;
alter table staff.orgs add column if not exists npi                   text;
alter table staff.orgs add column if not exists medical_director_name text;

create unique index if not exists staff_orgs_site_id
  on staff.orgs (site_id) where site_id is not null;

-- ---------- staff currency, not staff identity ----------
--
-- Expiry dates only. No date of birth, no licence numbers, no DEA
-- registration.
--
-- "Are all my medical assistants current on BLS?" is a real compliance
-- question and needs a DATE. "What is Jessica's licence number?" is not a
-- question this system has to answer, and storing the answer next to a
-- list of which controlled substances are on site and in what quantity
-- would make one leaked table an identity-theft kit and a
-- prescription-fraud enabler at the same time.
alter table staff.users add column if not exists bls_expires_on     date;
alter table staff.users add column if not exists license_expires_on date;
alter table staff.users add column if not exists arrt_expires_on    date;

-- What is expiring, and when, for everyone in an org. security_invoker so
-- it reads under the caller's RLS — see the note in staff-onboarding.sql.
create or replace view staff.credential_status
with (security_invoker = true) as
select
  u.id as user_id, u.org_slug, u.email, u.legal_name, u.role,
  c.kind, c.expires_on,
  (c.expires_on < current_date)                          as expired,
  (c.expires_on between current_date and current_date + 60) as expiring_soon
from staff.users u
cross join lateral (
  values ('BLS/CPR', u.bls_expires_on),
         ('Licence', u.license_expires_on),
         ('ARRT',    u.arrt_expires_on)
) as c(kind, expires_on)
where u.active and c.expires_on is not null;

grant select on staff.credential_status to staff_app;

-- ---------- the gate ----------
--
-- Read-only is enforced HERE, not only in a route handler. A trigger
-- cannot be forgotten by a future endpoint, an import script, or a
-- background job the way an `if` statement can.
create or replace function staff.reject_when_read_only()
returns trigger language plpgsql as $$
declare ro boolean;
begin
  select is_read_only into ro from staff.orgs where slug = new.org_slug;
  if ro then
    raise exception 'read_only: % is in read-only mode; existing records stay readable and exportable', new.org_slug
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists staff_responses_read_only on staff.form_responses;
create trigger staff_responses_read_only
  before insert on staff.form_responses
  for each row execute function staff.reject_when_read_only();

-- NOTE what is NOT gated: staff.attestations.
--
-- Signing a policy is part of somebody's employment record, not the
-- clinic's operational output. Blocking it during a lapse would punish an
-- employee for their employer's card failing, and would leave a real
-- compliance hole — an unsigned HIPAA acknowledgement — as the
-- consequence. Reading is never gated anywhere.

-- ---------- webhook replay protection ----------
--
-- Stripe retries a webhook until it gets a 2xx, and a retry after a
-- partial failure would otherwise re-run whatever the first attempt did.
-- Recording the event id first makes every handler idempotent for free:
-- the insert conflicts and the handler returns early.
create table if not exists staff.stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);

grant select, insert on staff.stripe_events to staff_app;
-- Not org-scoped: a Stripe event arrives before we know which org it is
-- about, and it holds nothing but an id and a type.
alter table staff.stripe_events enable row level security;
drop policy if exists staff_stripe_events_app on staff.stripe_events;
create policy staff_stripe_events_app on staff.stripe_events for all using (true) with check (true);

-- Provisioning a brand-new org from a checkout, before any org context
-- exists. Same reasoning as staff.resolve_signin: this is a bootstrap
-- that cannot be scoped, so it is narrow, SECURITY DEFINER, pinned
-- search_path, and revoked from public.
create or replace function staff.provision_org(
  p_slug text, p_name text, p_customer text, p_subscription text, p_email text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare final_slug text := p_slug; n int := 1;
begin
  -- Already provisioned for this Stripe customer: return the existing org
  -- rather than making a second one on a retry.
  select slug into final_slug from staff.orgs where stripe_customer_id = p_customer;
  if found then return final_slug; end if;

  final_slug := p_slug;
  while exists (select 1 from staff.orgs where slug = final_slug) loop
    n := n + 1;
    final_slug := p_slug || '-' || n;
  end loop;

  insert into staff.orgs (slug, name, plan, stripe_customer_id,
                          stripe_subscription_id, subscription_status,
                          is_read_only, billing_email)
  values (final_slug, p_name, 'stripe', p_customer, p_subscription,
          'active', false, p_email);

  -- The person who paid is the first administrator. Without this they
  -- would complete checkout and have nothing to sign into.
  insert into staff.org_invites (org_slug, email, role)
  values (final_slug, lower(p_email), 'org_admin');

  return final_slug;
end $$;

revoke all on function staff.provision_org(text, text, text, text, text) from public;
grant execute on function staff.provision_org(text, text, text, text, text) to staff_app;

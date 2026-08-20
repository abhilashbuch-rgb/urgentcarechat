-- ============================================================
-- CREDENTIALS AND EXCLUSION SCREENING
--
-- Run AFTER supabase/staff-job-roles-seed.sql. Idempotent.
--
-- WHY THIS REPLACES THE THREE COLUMNS ON staff.users
--
-- Credentials were bls_expires_on, license_expires_on and arrt_expires_on
-- — three date columns, so a clinic could track exactly three things and
-- adding a fourth was a migration. Real rosters have a DEA registration,
-- malpractice coverage, board certification, ACLS, PALS, a second state
-- licence for someone who works a border site, and a collaborative
-- practice agreement. Those are rows, not columns.
--
-- NO CREDENTIAL NUMBERS ARE STORED, and that is a deliberate refusal
-- rather than an omission. A table holding DEA registration numbers
-- against named prescribers is a prescription-fraud kit; one holding
-- licence numbers with dates of birth is an identity-theft kit. What
-- expiry tracking actually needs is the KIND, the ISSUER and the DATE,
-- and none of those are sensitive. When primary source verification
-- happens, what gets recorded here is that it happened and who did it —
-- the verification itself lives at the source, which is the only place
-- it is authoritative anyway.
-- ============================================================

do $$ begin
  create type staff.credential_kind as enum (
    'state_license',
    'dea_registration',
    'board_certification',
    'bls_cpr',
    'acls',
    'pals',
    'arrt',
    'malpractice',
    'collaborative_agreement',
    'other'
  );
exception when duplicate_object then null;
end $$;

create table if not exists staff.credentials (
  id          uuid primary key default gen_random_uuid(),
  org_slug    text not null references staff.orgs(slug) on delete cascade,
  user_id     uuid not null references staff.users(id) on delete cascade,
  kind        staff.credential_kind not null,
  -- Who issued it: a state code for a licence, a board's name for a
  -- certification, a carrier for malpractice. Free text because the
  -- vocabulary is genuinely open and a wrong enum blocks a real hire.
  issuer      text,
  -- Deliberately NOT the credential number. See the header.
  label       text,
  issued_on   date,
  expires_on  date,
  -- Primary source verification: the date somebody checked this against
  -- the issuing authority, not the date it was typed in.
  verified_on date,
  verified_by uuid references staff.users(id),
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists staff_credentials_user
  on staff.credentials (org_slug, user_id) where active;
create index if not exists staff_credentials_expiry
  on staff.credentials (org_slug, expires_on) where active and expires_on is not null;

alter table staff.credentials enable row level security;
alter table staff.credentials force row level security;
drop policy if exists staff_org_isolation on staff.credentials;
create policy staff_org_isolation on staff.credentials
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());
grant select, insert, update on staff.credentials to staff_app;
revoke delete on staff.credentials from staff_app;

-- Carry the three old columns across, once, so nobody loses a date that
-- was already entered. Guarded on not-exists so re-running cannot create
-- duplicates.
insert into staff.credentials (org_slug, user_id, kind, expires_on)
select u.org_slug, u.id, k.kind, k.d
from staff.users u
cross join lateral (values
  ('bls_cpr'::staff.credential_kind,       u.bls_expires_on),
  ('state_license'::staff.credential_kind, u.license_expires_on),
  ('arrt'::staff.credential_kind,          u.arrt_expires_on)
) as k(kind, d)
where k.d is not null
  and not exists (
    select 1 from staff.credentials c
     where c.user_id = u.id and c.kind = k.kind and c.expires_on = k.d
  );

-- ============================================================
-- EXCLUSION SCREENING
--
-- Employing or contracting with an excluded individual means the federal
-- health care programs will not pay for ANYTHING that person is involved
-- in, directly or indirectly, and civil monetary penalties attach per
-- item or service claimed. The OIG's own guidance is to screen the
-- exclusion list on hire and MONTHLY thereafter, which is why the
-- obligation this seeds repeats monthly rather than annually.
--
-- Sources worth screening:
--   OIG LEIE        — the federal exclusion list, published monthly
--   SAM.gov         — federal procurement/award debarment
--   State Medicaid  — most states publish their own, and a state
--                     exclusion is not always mirrored federally
--
-- WHAT THIS TABLE IS: the record that a screen happened, against whom,
-- on what date, with what result. It is the evidence a surveyor or a
-- payer asks for.
--
-- WHAT IT IS NOT, YET: an automated download. The LEIE is a published
-- CSV and SAM.gov has an API, so screening could be run for the whole
-- roster on a schedule — but a name-only match produces false positives
-- on common names, and resolving one requires a date of birth or an SSN
-- that this system deliberately does not hold. So the check stays human,
-- and what is automated is remembering that it is due.
-- ============================================================

do $$ begin
  create type staff.exclusion_source as enum ('oig_leie', 'sam_gov', 'state_medicaid');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type staff.exclusion_result as enum ('clear', 'possible_match', 'excluded');
exception when duplicate_object then null;
end $$;

create table if not exists staff.exclusion_checks (
  id          uuid primary key default gen_random_uuid(),
  org_slug    text not null references staff.orgs(slug) on delete cascade,
  user_id     uuid not null references staff.users(id) on delete cascade,
  source      staff.exclusion_source not null,
  checked_on  date not null default current_date,
  result      staff.exclusion_result not null,
  -- Required when the result is anything but clear: what was found and
  -- what was done about it. A "possible match" with no note is the same
  -- as no screen at all.
  detail      text,
  checked_by  uuid references staff.users(id),
  created_at  timestamptz not null default now()
);

do $$ begin
  alter table staff.exclusion_checks
    add constraint staff_exclusion_needs_detail
    check (result = 'clear' or (detail is not null and length(btrim(detail)) >= 3));
exception when duplicate_object then null;
end $$;

create index if not exists staff_exclusion_recent
  on staff.exclusion_checks (org_slug, user_id, checked_on desc);

alter table staff.exclusion_checks enable row level security;
alter table staff.exclusion_checks force row level security;
drop policy if exists staff_org_isolation on staff.exclusion_checks;
create policy staff_org_isolation on staff.exclusion_checks
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());
-- Append-only in practice: a screening record is evidence of what was
-- known on a date. Correcting one means recording a new screen.
grant select, insert on staff.exclusion_checks to staff_app;

-- ============================================================
-- THE ROSTER VIEW
--
-- One row per active person: what is expiring, and when they were last
-- screened. Derived on read for the same reason overdue is — a nightly
-- job that computes "expiring soon" is a job whose failure looks exactly
-- like "nothing is expiring".
-- ============================================================

drop view if exists staff.credential_status cascade;
create view staff.credential_status
with (security_invoker = true) as
select
  c.id            as credential_id,
  c.org_slug,
  u.id            as user_id,
  u.email,
  u.legal_name,
  u.role,
  u.job_role,
  c.kind,
  c.issuer,
  c.label,
  c.issued_on,
  c.expires_on,
  c.verified_on,
  (c.expires_on - current_date)                as days_left,
  case
    when c.expires_on is null                  then 'no_date'
    when c.expires_on < current_date           then 'expired'
    when c.expires_on <= current_date + 30     then 'critical'
    when c.expires_on <= current_date + 90     then 'expiring'
    else 'current'
  end                                          as status
from staff.credentials c
join staff.users u on u.id = c.user_id
where c.active and u.active;

grant select on staff.credential_status to staff_app;

-- Latest screen per person per source, and how stale it is. A person who
-- has never been screened shows up with a null date rather than being
-- absent, because "never screened" is the finding.
-- Dropped first rather than CREATE OR REPLACE: replace can only APPEND
-- columns to a view, so once a later migration extends this one, the
-- combined setup file's second run fails here with "cannot drop
-- columns from view" while its first run was clean. Drop-first makes
-- every view definition rerunnable regardless of what extends it.
drop view if exists staff.exclusion_status cascade;
create view staff.exclusion_status
with (security_invoker = true) as
select
  u.org_slug,
  u.id as user_id,
  u.email,
  u.legal_name,
  s.source,
  x.checked_on,
  x.result,
  (current_date - x.checked_on)      as days_since,
  case
    when x.checked_on is null                   then 'never'
    when x.result <> 'clear'                    then 'flagged'
    when x.checked_on < current_date - 31       then 'overdue'
    else 'current'
  end                                as status
from staff.users u
cross join (values ('oig_leie'::staff.exclusion_source),
                   ('sam_gov'::staff.exclusion_source)) as s(source)
left join lateral (
  select checked_on, result
    from staff.exclusion_checks e
   where e.user_id = u.id and e.source = s.source
   order by checked_on desc
   limit 1
) x on true
where u.active;

grant select on staff.exclusion_status to staff_app;

-- One number for the dashboard.
-- Dropped first rather than CREATE OR REPLACE: replace can only APPEND
-- columns to a view, so once a later migration extends this one, the
-- combined setup file's second run fails here with "cannot drop
-- columns from view" while its first run was clean. Drop-first makes
-- every view definition rerunnable regardless of what extends it.
drop view if exists staff.roster_risk cascade;
create view staff.roster_risk
with (security_invoker = true) as
select
  o.slug as org_slug,
  (select count(*) from staff.credential_status c
    where c.org_slug = o.slug and c.status = 'expired')::int   as expired,
  (select count(*) from staff.credential_status c
    where c.org_slug = o.slug and c.status = 'critical')::int  as expiring_30,
  (select count(*) from staff.exclusion_status e
    where e.org_slug = o.slug and e.status in ('never','overdue'))::int as screens_due,
  (select count(*) from staff.exclusion_status e
    where e.org_slug = o.slug and e.status = 'flagged')::int   as screens_flagged
from staff.orgs o;

grant select on staff.roster_risk to staff_app;

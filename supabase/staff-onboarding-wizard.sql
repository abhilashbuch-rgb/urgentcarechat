-- ============================================================
-- ONBOARDING: THE JOB, THE PHONE, AND THE CREDENTIALS
--
-- Run AFTER supabase/staff-credentials.sql and staff-job-roles.sql.
-- Idempotent; safe to re-run.
--
-- WHAT WAS MISSING, AND WHY IT MATTERED
-- -------------------------------------
-- Onboarding already collected a legal name, e-sign consent, and a
-- signature per policy document, with the document's hash, the IP and
-- the user agent stored against each one. That half was fine.
--
-- Three things were not collected, and each left a hole somewhere else
-- in the product:
--
--   THE JOB. staff.users.job_role stayed null until an administrator set
--   it by hand, which meant a new hire finished onboarding and landed on
--   a board showing almost nothing — strict separation working exactly
--   as designed and looking exactly like a broken app. The job belongs
--   on the INVITE, decided by whoever invited them.
--
--   THE CREDENTIALS. staff.credentials existed and nothing ever wrote to
--   it during onboarding, so the roster's expiry tracking started life
--   empty for every new hire and only became true if somebody
--   remembered to backfill it.
--
--   A PHONE NUMBER. There was no way to reach the person the roster says
--   is responsible for something.
--
-- WHAT IS DELIBERATELY NOT ADDED HERE
-- -----------------------------------
-- No date of birth, no SSN, no DEA number, no licence number, no
-- certificate number of any kind. Expiry DATES only. This is the same
-- refusal as staff-credentials.sql and for the same reason: a licence
-- number is worth stealing and an expiry date is not, and every question
-- this product actually answers ("is anyone working expired?") is
-- answerable from the date alone.
--
-- AND THE STAFF MEMBER DOES NOT PICK THEIR OWN JOB. The wizard shows
-- them the job the invite assigned and asks them to confirm it. Letting
-- somebody self-select "Provider" on their first screen would defeat the
-- entire separation model at the one moment nobody is watching. If it is
-- wrong they say so and it stops there — an administrator fixes the
-- invite. That is a slower path and it is the correct one.
-- ============================================================

-- The job travels on the invite, so it is decided by the person doing
-- the inviting and is already true before the new hire ever signs in.
alter table staff.org_invites
  add column if not exists job_role staff.job_role;

-- Optional pre-fill. Google gives a display name, which is frequently
-- not the name that belongs on a signed record ("Dee" for "Deirdre
-- O'Connell"). An inviter who knows the legal name can put it here.
alter table staff.org_invites
  add column if not exists legal_name text;

alter table staff.users
  add column if not exists phone text;

-- Set when the person finishes the wizard: the job confirmed, the
-- credentials their job requires entered, and every assigned document
-- signed.
--
-- STORED, UNLIKE ALMOST EVERYTHING ELSE IN THIS MODULE, and the
-- exception needs justifying. Overdue and expired are derived because
-- deriving them cannot go stale. This cannot be derived the same way:
-- "has seen the orientation" is a fact about a person's attention, and
-- there is nothing in the database to compute it from. Every other gate
-- in the wizard IS still derived — the profile, the job, the
-- credentials, the documents are all recomputed per request — so this
-- column gates one screen and cannot make anything else look done.
alter table staff.users
  add column if not exists onboarded_at timestamptz;

-- When the person read and confirmed the job on their invite.
--
-- SEPARATE FROM job_role BEING SET, and the distinction is the whole
-- reason the step exists. "Has a job" is a fact about the invite;
-- "confirmed the job" is a fact about the person having read which side
-- of the scope-of-practice line they are on. Gating on job_role alone
-- skipped the step entirely for every properly-invited hire — which is
-- everyone the step was written for.
alter table staff.users
  add column if not exists job_confirmed_at timestamptz;

comment on column staff.users.onboarded_at is
  'When the orientation was acknowledged. Gates the orientation screen only; every other onboarding step is derived per request.';

-- ============================================================
-- WHICH CREDENTIALS A JOB HAS TO HAVE
--
-- A table, not a CASE in TypeScript, so the roster's "who is missing
-- what" question and the wizard's "what do I ask this person for"
-- question are answered from one place. A clinic that needs ACLS from
-- its providers adds a row; it does not need a deploy.
-- ============================================================

create table if not exists staff.job_credential_requirements (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  job_role staff.job_role not null,
  kind staff.credential_kind not null,

  -- False for a credential that is tracked when present but does not
  -- block onboarding — a provider's board certification, say.
  required boolean not null default true,

  -- Shown next to the date field. Without it the field says
  -- "bls_cpr" at somebody on their first morning.
  label text not null,
  -- One line under the field, where the field alone is ambiguous.
  hint text,

  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists staff_job_cred_req_key
  on staff.job_credential_requirements (org_slug, job_role, kind);

alter table staff.job_credential_requirements enable row level security;
alter table staff.job_credential_requirements force row level security;
drop policy if exists staff_org_isolation on staff.job_credential_requirements;
create policy staff_org_isolation on staff.job_credential_requirements
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.job_credential_requirements to staff_app;
revoke delete on staff.job_credential_requirements from staff_app;

-- ============================================================
-- WHAT IS LEFT TO DO
--
-- One row per user, recomputed on read. The wizard renders the first
-- unfinished step rather than tracking a step number, so a refresh, the
-- back button, a second tab and a phone that slept mid-signature all
-- behave correctly without any of them being handled — the same
-- reasoning as the existing document loop, extended to the new steps.
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first rather than CREATE OR REPLACE, so a later migration that inserts
-- a column cannot break this file's second run.
-- ============================================================

drop view if exists staff.onboarding_state cascade;
create view staff.onboarding_state
with (security_invoker = true) as
select
  u.id as user_id,
  u.org_slug,
  u.job_role,
  u.onboarded_at,

  (u.legal_name is null or u.esign_consented_at is null) as needs_profile,
  (u.job_role is null or u.job_confirmed_at is null)     as needs_job,
  -- Distinguishes "nobody told us what you do" from "you have not read
  -- it yet". The first is an administrator's problem and the wizard
  -- says so; the second is one tap.
  (u.job_role is null)                                   as job_unassigned,

  -- Required credentials for this job with no active row carrying an
  -- expiry date. Empty for a job with no requirements, and empty for a
  -- person with no job — who is stopped at needs_job anyway.
  coalesce(missing.kinds, '{}')                          as missing_credentials,

  coalesce(docs.outstanding, 0)                          as outstanding_docs,
  (u.onboarded_at is null)                               as needs_orientation
from staff.users u
left join lateral (
  select array_agg(req.kind::text order by req.sort_order) as kinds
    from staff.job_credential_requirements req
   where req.org_slug = u.org_slug
     and req.job_role = u.job_role
     and req.active
     and req.required
     and not exists (
       select 1 from staff.credentials c
        where c.user_id = u.id
          and c.kind = req.kind
          and c.active
          and c.expires_on is not null
     )
) missing on true
left join lateral (
  select count(*)::int as outstanding
    from staff.outstanding_docs od
   where od.user_id = u.id
) docs on true;

grant select on staff.onboarding_state to staff_app;

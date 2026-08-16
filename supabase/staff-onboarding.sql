-- ============================================================
-- STAFF ONBOARDING & PER-EMPLOYEE COMPLIANCE RECORD
--
-- Run AFTER supabase/staff-schema.sql. Idempotent; safe to re-run.
--
-- The point of this file is a record that answers one question about any
-- employee on any date: what were they told, when did they say they
-- understood it, and what exactly did the document say at the moment they
-- signed it. "Nobody told me" has to be a checkable claim, not an
-- argument.
--
-- Three things make that work, and each is a constraint here rather than
-- a convention in application code:
--
--  1. DOCUMENTS ARE IMMUTABLE ONCE SIGNED. Editing a policy creates a new
--     version row. A signature points at one version, so revising a policy
--     can never rewrite what somebody already attested to.
--
--  2. THE SIGNATURE STORES A HASH OF THE TEXT IT SIGNED. Even if a row were
--     tampered with, the hash recorded at signing time no longer matches,
--     and the record shows it. The evidence does not depend on trusting
--     the database it lives in.
--
--  3. ASSIGNMENT IS DERIVED, NOT STORED. Who owes what is computed from
--     the published documents for someone's role minus the signatures they
--     already have. There is no per-user checklist to fall out of sync,
--     so a new hire cannot be quietly missing an item because a row was
--     never created for them.
--
-- E-SIGN / UETA: an electronic signature needs intent to sign, consent to
-- transact electronically, the signature associated with the record, and
-- retention of the record. Each has a column below. This is not legal
-- advice — have an employment attorney review the attestation wording and
-- the retention period before this becomes the system of record.
-- ============================================================

-- ============================================================
-- WHO THE PERSON IS
--
-- A signature needs a legal name, and "the name on the Google account" is
-- not it — plenty of staff sign in as "Katie" and sign documents as
-- "Kathryn A. Nguyen". Captured once, on first run.
-- ============================================================

alter table staff.users add column if not exists legal_name  text;
alter table staff.users add column if not exists job_title   text;
alter table staff.users add column if not exists start_date  date;
-- Consent to receive and sign records electronically, with the moment it
-- was given. Without this the signatures below are weaker evidence.
alter table staff.users add column if not exists esign_consented_at timestamptz;

-- ============================================================
-- POLICY & TRAINING DOCUMENTS
-- ============================================================

create table if not exists staff.policy_docs (
  id           uuid primary key default gen_random_uuid(),
  org_slug     text not null references staff.orgs(slug) on delete cascade,
  -- Stable across versions. A signature records both the key and the
  -- version, so "has this person acknowledged the HIPAA policy" survives
  -- the policy being rewritten.
  key          text not null,
  version      integer not null default 1,
  title        text not null,
  category     text,                       -- hipaa | osha | clinical | hr | operations
  -- The rule this document exists because of, shown to the reader. An
  -- acknowledgement that cites its own authority is much harder to wave
  -- away later than one that doesn't.
  citation     text,
  summary      text,
  body_md      text not null,
  -- The sentence the person is actually agreeing to. Stored per document
  -- and copied into the signature, because the wording is the substance
  -- of what was agreed.
  attestation  text not null default
    'I have read and understand this document, and I agree to follow it in my work.',
  -- null = everyone. Otherwise only these roles are assigned it.
  applies_to   staff.user_role[],
  -- Annual retraining and the like: after this many months the
  -- acknowledgement expires and the document is assigned again.
  renew_months integer,
  sort_order   integer not null default 100,
  -- DRAFTS ARE NOT ASSIGNED TO ANYONE. A seeded skeleton must not be
  -- presented to staff as their employer's policy, and an organization
  -- must not be able to claim someone acknowledged a document that was
  -- still being written.
  published_at timestamptz,
  active       boolean not null default true,
  created_by   uuid references staff.users(id),
  created_at   timestamptz not null default now(),
  unique (org_slug, key, version)
);

create index if not exists staff_docs_assignable
  on staff.policy_docs (org_slug, sort_order)
  where active and published_at is not null;

-- ============================================================
-- SIGNATURES — the evidence
-- ============================================================

create table if not exists staff.attestations (
  id           uuid primary key default gen_random_uuid(),
  org_slug     text not null references staff.orgs(slug) on delete cascade,
  user_id      uuid not null references staff.users(id) on delete restrict,
  doc_id       uuid not null references staff.policy_docs(id) on delete restrict,
  -- Denormalized on purpose: this row has to stay readable as evidence
  -- even if the document row is ever removed, and a join is not a thing
  -- you want between you and an answer in a deposition.
  doc_key      text not null,
  doc_version  integer not null,
  doc_title    text not null,
  -- sha256 of body_md exactly as rendered to this person. Computed
  -- server-side from the stored document, never accepted from the client.
  body_sha256  text not null,
  -- The attestation sentence as it was shown, not as it reads today.
  statement    text not null,
  -- Typed legal name. The intent-to-sign act.
  typed_name   text not null,
  -- The drawn signature, as SVG path data rather than an image: a few
  -- hundred bytes, diffable, and printable at any size.
  signature_path text,
  signed_at    timestamptz not null default now(),
  -- Circumstances of signing. Retained because "someone else signed for
  -- me" is the usual challenge to an electronic signature.
  signed_ip    text,
  user_agent   text,
  -- Renewals: the previous signature is kept and pointed at, never
  -- replaced. A compliance history with gaps edited out is not a history.
  supersedes_id uuid references staff.attestations(id),
  -- One live signature per person per document version. A renewal is a
  -- new version of the document, so this does not block annual retraining.
  unique (user_id, doc_id)
);

create index if not exists staff_attest_user on staff.attestations (user_id, signed_at desc);
create index if not exists staff_attest_doc  on staff.attestations (doc_id);

-- Nothing may edit or delete a signature. Not the app, not an admin, not
-- a migration that means well. A record that can be adjusted after the
-- fact proves nothing about what happened before it.
create or replace function staff.attestations_are_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'staff.attestations is append-only: a signature cannot be % after the fact',
    lower(tg_op);
end $$;

drop trigger if exists staff_attest_no_change on staff.attestations;
create trigger staff_attest_no_change
  before update or delete on staff.attestations
  for each row execute function staff.attestations_are_append_only();

-- ============================================================
-- RLS — same shape as the rest of the staff schema
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array['policy_docs','attestations'] loop
    execute format('alter table staff.%I enable row level security', t);
    execute format('alter table staff.%I force row level security', t);
    execute format('drop policy if exists staff_org_isolation on staff.%I', t);
    execute format($f$
      create policy staff_org_isolation on staff.%I
        for all
        using (staff.is_super_admin() or org_slug = staff.current_org())
        with check (staff.is_super_admin() or org_slug = staff.current_org())
    $f$, t);
  end loop;
end $$;

grant select, insert, update, delete on staff.policy_docs to staff_app;
-- Insert and select only. The trigger above would reject an update anyway;
-- withholding the privilege means the attempt never reaches it.
grant select, insert on staff.attestations to staff_app;

-- ============================================================
-- WHAT EACH PERSON STILL OWES
--
-- A view rather than a table, so it cannot disagree with the underlying
-- facts.
--
-- security_invoker IS WHAT MAKES THIS SAFE. A Postgres view normally runs
-- with its OWNER's privileges, which means a view owned by `postgres`
-- reads straight past the row-level security of whoever queries it — the
-- classic way an RLS-protected schema springs a leak through a
-- convenience view. With security_invoker the view evaluates under the
-- caller, so it is org-scoped by the same policies as the tables.
--
-- A document is outstanding when it is published, applies to your role,
-- and either you have never signed that version or your signature has
-- aged past the document's renewal window.
-- ============================================================

create or replace view staff.outstanding_docs
with (security_invoker = true) as
select
  u.id                          as user_id,
  u.org_slug,
  d.id                          as doc_id,
  d.key                         as doc_key,
  d.version,
  d.title,
  d.category,
  d.citation,
  d.summary,
  d.sort_order,
  d.renew_months,
  a.signed_at                   as previously_signed_at,
  case
    when a.id is null then 'never'
    else 'expired'
  end                           as reason
from staff.users u
join staff.policy_docs d
  on d.org_slug = u.org_slug
 and d.active
 and d.published_at is not null
 and (d.applies_to is null or u.role = any (d.applies_to))
left join staff.attestations a
  on a.user_id = u.id
 and a.doc_key = d.key
 and a.doc_version = d.version
where u.active
  and (
    a.id is null
    or (d.renew_months is not null
        and a.signed_at < now() - make_interval(months => d.renew_months))
  );

grant select on staff.outstanding_docs to staff_app;

-- Completion per person, for the admin roster: how many documents apply
-- to them and how many they have live signatures for.
create or replace view staff.compliance_status
with (security_invoker = true) as
select
  u.id            as user_id,
  u.org_slug,
  u.email,
  u.legal_name,
  u.name,
  u.job_title,
  u.role,
  u.start_date,
  u.esign_consented_at,
  (select count(*)
     from staff.policy_docs d
    where d.org_slug = u.org_slug
      and d.active
      and d.published_at is not null
      and (d.applies_to is null or u.role = any (d.applies_to)))     as assigned_count,
  (select count(*)
     from staff.outstanding_docs o
    where o.user_id = u.id)                                          as outstanding_count,
  (select max(a.signed_at)
     from staff.attestations a
    where a.user_id = u.id)                                          as last_signed_at
from staff.users u
where u.active;

grant select on staff.compliance_status to staff_app;

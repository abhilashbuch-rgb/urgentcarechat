-- ============================================================
-- THE PERSONAL DOCUMENT VAULT
--
-- Run AFTER supabase/staff-credentials.sql. Idempotent.
--
-- WHAT THIS IS FOR
-- ----------------
-- staff.credentials answers the ORGANISATION's question: is anybody on
-- this roster working expired. It is read on the roster page by clinical
-- leads and administrators, and until now it was the only place a
-- credential could live — which meant the only way a BLS card got on
-- file was somebody senior typing it in.
--
-- This is the same fact from the other end: MY cards, MY licence, MY CME
-- proofs, maintained by me. One person's shelf rather than the clinic's
-- filing cabinet, and the thing that finally lets the roster be accurate
-- without an administrator doing data entry for twenty people.
--
-- ONE FACT, NOT TWO. A document that carries an expiry date UPDATES the
-- matching staff.credentials row rather than storing a second copy of
-- the date. Two independent copies of "when does your BLS expire" is two
-- answers to one question, and the roster would be reading whichever one
-- nobody was maintaining.
--
-- A NOTE ON THE FILE ITSELF. file_path is a key in object storage, never
-- the bytes. Postgres is not a file server, and a scanned licence in a
-- table column is a row nobody can back up cheaply and a payload every
-- query planner has to step over.
--
-- AND IT IS NULLABLE, deliberately. A person can record "my BLS expires
-- in March" without having a scan to hand, and that is worth far more
-- than nothing: the roster can chase an expiry it knows about. Requiring
-- a file to record a date would mean the dates that matter most — the
-- ones belonging to people who have not got round to scanning anything —
-- are exactly the ones missing.
-- ============================================================

create table if not exists staff.user_documents (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  user_id uuid not null references staff.users(id) on delete cascade,

  -- Wider than staff.credential_kind on purpose: a CME log and a peer
  -- review are documents somebody keeps, and neither is a credential
  -- with an issuer and an expiry.
  doc_type text not null check (doc_type in (
    'bls_cpr', 'state_license', 'arrt_permit', 'board_certification',
    'malpractice', 'cme_log', 'peer_review', 'other'
  )),

  title text not null,

  -- The credential this proves, when it proves one. Set by the app so a
  -- BLS card and the BLS row on the roster are the same fact.
  credential_id uuid references staff.credentials(id) on delete set null,

  -- Object-storage key. Null while somebody has recorded the date but
  -- not yet uploaded the scan.
  file_path text,
  file_type text,
  file_bytes integer check (file_bytes is null or file_bytes > 0),

  expires_on date,

  -- Whether anyone senior has actually looked at it. Defaults to
  -- unverified, NOT verified: a self-uploaded document that the system
  -- calls "verified" the instant it lands is a system asserting
  -- something nobody checked, and on the one screen where that assertion
  -- gets shown to a surveyor.
  verified_on date,
  verified_by uuid references staff.users(id),

  active boolean not null default true,
  uploaded_at timestamptz not null default now()
);

create index if not exists staff_user_documents_mine
  on staff.user_documents (org_slug, user_id, doc_type)
  where active;

create index if not exists staff_user_documents_expiry
  on staff.user_documents (org_slug, expires_on)
  where active and expires_on is not null;

-- Verified by whom, on what day — both or neither. A verification date
-- with nobody's name on it is not a verification.
do $$ begin
  alter table staff.user_documents
    add constraint staff_user_doc_verification_complete
    check ((verified_on is null) = (verified_by is null));
exception when duplicate_object then null;
end $$;

-- A row that is neither a date nor a file is an empty row.
do $$ begin
  alter table staff.user_documents
    add constraint staff_user_doc_has_content
    check (file_path is not null or expires_on is not null);
exception when duplicate_object then null;
end $$;

alter table staff.user_documents enable row level security;
alter table staff.user_documents force row level security;

drop policy if exists staff_org_isolation on staff.user_documents;
create policy staff_org_isolation on staff.user_documents
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

-- ORG-SCOPED, NOT USER-SCOPED, AND THAT IS NOT AN OVERSIGHT. There is
-- one database role for the whole application and the session's user id
-- is not available to RLS — see staff.current_org() in staff-schema.sql,
-- which is set per connection from the signed session cookie. Per-user
-- isolation is enforced in the query layer, which is where every other
-- per-user rule in this module already lives.
--
-- The practical consequence, stated plainly: a bug in a route that omits
-- `where user_id = me` would show one person another person's documents
-- inside the same clinic. It would not cross clinics — that is what this
-- policy guarantees. lib/staff/documents.ts takes the user id as a
-- required argument for exactly this reason.
grant select, insert, update on staff.user_documents to staff_app;
revoke delete on staff.user_documents from staff_app;

-- ============================================================
-- MY SHELF
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break the second
-- run of the combined setup file.
-- ============================================================

drop view if exists staff.my_documents cascade;
create view staff.my_documents
with (security_invoker = true) as
select
  d.id,
  d.org_slug,
  d.user_id,
  d.doc_type,
  d.title,
  d.credential_id,
  d.file_path,
  d.file_type,
  d.file_bytes,
  d.expires_on,
  d.verified_on,
  v.legal_name as verified_by_name,
  d.uploaded_at,
  (d.file_path is not null) as has_file,
  -- Derived on read, like every other expiry in this module. A nightly
  -- job that marks things expired is a job whose failure looks exactly
  -- like "nothing is expired".
  case
    when d.expires_on is null                     then 'no_date'
    when d.expires_on < current_date              then 'expired'
    when d.expires_on <= current_date + 60        then 'expiring'
    else 'current'
  end as status,
  (d.expires_on - current_date) as days_left
from staff.user_documents d
left join staff.users v on v.id = d.verified_by
where d.active;

grant select on staff.my_documents to staff_app;

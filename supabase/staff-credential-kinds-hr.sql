-- ============================================================
-- TWO MORE CREDENTIAL KINDS: TB SCREENING, HEPATITIS B
--
-- Run AFTER supabase/staff-credentials.sql and staff-documents.sql. Idempotent.
--
-- ACHC's Ambulatory Care standards (AC4-2B, AC4-2C) ask every clinic to
-- track a baseline TB screening and Hepatitis B vaccination status (or a
-- signed declination) for direct-care personnel, the same way this
-- roster already tracks BLS/CPR and a state licence. Neither existed as
-- a credential kind before this file.
--
-- ONE FILE, NOTHING REFERENCES THE NEW VALUES. Postgres will not let a
-- freshly added enum value be used in the same transaction that added
-- it, and a multi-statement paste runs as one transaction — see
-- staff-manager-role.sql for the same rule. Nothing below casts a
-- literal to either new value (no seed row uses them), so there is
-- nothing here that could trip it.
-- ============================================================

alter type staff.credential_kind add value if not exists 'tb_screening'
  after 'collaborative_agreement';
alter type staff.credential_kind add value if not exists 'hepatitis_b_vaccination'
  after 'tb_screening';

-- staff.user_documents.doc_type is deliberately a plain text CHECK, not
-- this enum — see staff-documents.sql's own header for why (a CME log
-- and a peer review are documents, not credentials with an issuer and
-- an expiry). Widened to match the two kinds above.
--
-- The constraint's name is found rather than assumed: it was declared
-- inline in the original CREATE TABLE with no name of its own, so
-- Postgres chose one, and guessing wrong here would silently leave the
-- old, narrower constraint in place instead of replacing it.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'staff.user_documents'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%doc_type%'
  loop
    execute format('alter table staff.user_documents drop constraint %I', c.conname);
  end loop;
end $$;

alter table staff.user_documents add constraint user_documents_doc_type_check
  check (doc_type in (
    'bls_cpr', 'state_license', 'arrt_permit', 'board_certification',
    'malpractice', 'cme_log', 'peer_review',
    'tb_screening', 'hepatitis_b_vaccination', 'other'
  ));

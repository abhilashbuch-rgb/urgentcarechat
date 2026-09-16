-- ============================================================
-- WHAT SOMEONE GOES BY, SEPARATE FROM THEIR LEGAL SIGNING NAME
--
-- staff.users.legal_name exists specifically for e-signature evidence
-- (see the header of staff-onboarding.sql: "a signature needs a legal
-- name, and the name on the Google account is not it") — Sahereh signs
-- compliance documents as Sahereh zhian, and that must never quietly
-- become "Ellie" because that's what the floor calls her.
--
-- But "your Center admin today is Ellie" was the whole point of the
-- on-duty banner (onDutyToday(), lib/staff/roster-today.ts) — a shift
-- reading a name they don't recognize on their own clinic's front page
-- defeats it. So this is a second, purely cosmetic field: never read
-- for a signature, an audit log, or any compliance document, only for
-- the handful of everyday, casual displays where "who do I ask" matters
-- more than "who is legally on file."
-- ============================================================

alter table staff.users
  add column if not exists preferred_name text;

comment on column staff.users.preferred_name is
  'What this person goes by day to day, if different from legal_name — shown on the on-duty banner and similar casual displays ONLY. Never read for e-signature, audit, or any compliance document; legal_name remains the record of who signed what.';

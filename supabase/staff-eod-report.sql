-- ============================================================
-- THE ADMIN'S END-OF-DAY REPORT, AND AN OPT-IN DIGEST FOR EVERYONE ELSE
--
-- Run AFTER supabase/staff-reports.sql. Idempotent.
--
-- staff-reports.sql built a report an owner subscribes an ARBITRARY
-- ADDRESS to — the right shape for an accountant or a franchise manager
-- with no staff account. It never automatically reaches the people who
-- actually administer the clinic day to day, and it never reached staff
-- at all. This file adds the other half: every active org_admin and
-- platform_super_admin gets today's report automatically, no
-- subscription required, and any employee can opt into the routine
-- digest that used to be owner/medical-director only.
--
-- ONE COLUMN. wants_digest is deliberately not a JSONB bag of
-- preferences — there is exactly one optional notification today (the
-- AM/PM "what got done" digest), and a table of one boolean is honest
-- about that. Urgent alerts (excursions, missed tasks) are unaffected:
-- there is still no column to turn those off, for the reason already
-- given in staff-alerts.sql.
-- ============================================================

alter table staff.users
  add column if not exists wants_digest boolean not null default false;

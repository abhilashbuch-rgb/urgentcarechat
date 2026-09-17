-- ============================================================
-- FORCE RLS ON SEVEN MORE TABLES THAT SHIPPED WITHOUT IT
--
-- Found during a security audit: staff-force-rls-normalize.sql fixed
-- five tables in 2026, but seven others were still missing FORCE --
-- facility_templates, org_groups, org_seat_overrides, plan_seats,
-- report_runs, report_subscriptions, and user_orgs. Unlike that
-- earlier five, these all carry the normal org-scoped
-- staff_org_isolation policy (or its equivalent), not a blanket
-- `true` -- so this is the same house-pattern normalization, not a
-- fix for a different kind of gap.
--
-- staff_app, the app's real connection role, is never the owner of
-- any staff.* table (postgres is) and has neither rolsuper nor
-- rolbypassrls (verified directly against pg_roles during the audit).
-- FORCE only changes behavior for the table owner or a role with
-- BYPASSRLS, so this closes a defense-in-depth gap rather than one
-- that was ever reachable in production -- same reasoning as the
-- file above, restated here so a future reader doesn't have to
-- re-derive it.
-- ============================================================

alter table staff.facility_templates force row level security;
alter table staff.org_groups force row level security;
alter table staff.org_seat_overrides force row level security;
alter table staff.plan_seats force row level security;
alter table staff.report_runs force row level security;
alter table staff.report_subscriptions force row level security;
alter table staff.user_orgs force row level security;

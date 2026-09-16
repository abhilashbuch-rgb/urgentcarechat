-- ============================================================
-- FORCE RLS ON THE FIVE TABLES THAT SHIPPED WITHOUT IT
--
-- staff.stripe_events and the four staff.email_* campaign tables
-- enabled row level security but never added FORCE, unlike every
-- other RLS table in this schema. Their policies are already
-- `to public using (true)` — global, no per-session identity to
-- check — so this changes nothing about who can read or write them.
-- It only closes the one gap FORCE actually matters for: the table
-- owner (a superuser role) bypassing RLS entirely without it. Since
-- staff_app, the app's real connection role, is never the owner,
-- this is a house-pattern normalization, not a behavior change.
-- ============================================================

alter table staff.stripe_events force row level security;
alter table staff.email_campaigns force row level security;
alter table staff.email_campaign_steps force row level security;
alter table staff.email_recipients force row level security;
alter table staff.email_sends force row level security;

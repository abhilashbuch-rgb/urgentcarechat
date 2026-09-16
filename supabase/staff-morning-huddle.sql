-- The morning huddle: a good-morning email at the start of the day for
-- whoever is actually scheduled to work it. See lib/staff/huddle.ts.
--
-- NO OPT-OUT, ON PURPOSE. The owner was explicit: "it should be default
-- for all that work that day" — and, later, explicit again that there
-- should be no toggle at all, for anyone. This isn't a subscription,
-- it's the morning huddle every shift already has informally, just
-- written down and delivered on time — the same "administering the
-- clinic carries seeing this by default" reasoning the EOD report and
-- an excursion alert already use, with no switch to disable either.
-- Targeting is entirely staff.users.workdays (staff-workdays.sql): a
-- person not scheduled today gets nothing, scheduled means they get it.
--
-- (An earlier version of this added a wants_morning_huddle column with
-- a per-person toggle. Removed — see staff-morning-huddle-no-toggle.sql
-- — before it reached any real use.)

-- Same shape as digest_am_at / digest_pm_at (staff-alerts.sql): a plain
-- per-org local time the hourly cron compares itself against, not a
-- second cron job. 08:00 because the owner asked for the MAs and front
-- desk to have it "so they know they have to start their day" — before
-- the clinic's own operating_hours_start, not after.
alter table staff.orgs
  add column if not exists huddle_at time not null default '08:00';

comment on column staff.orgs.huddle_at is
  'Local time the morning-huddle email goes out to everyone scheduled to work today. See app/api/cron/alerts/route.ts.';

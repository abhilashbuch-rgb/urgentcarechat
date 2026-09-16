-- Two escalating "still not done" reminders after the morning huddle,
-- for anyone who still has something due or late at that hour. See
-- lib/staff/huddle.ts's followUpFor() and app/api/cron/alerts/route.ts.
--
-- NO OPT-OUT, same reasoning as huddle_at (staff-morning-huddle.sql):
-- the owner was explicit this is an admin decision about how the
-- clinic runs, not a personal subscription preference. Nobody gets a
-- switch to turn it off, including the owner's own account.
--
-- SILENT WHEN THERE IS NOTHING LEFT TO CHASE. followUpFor() returns
-- null and nothing is sent when a person has already finished
-- everything due — this is a chase, not a check-in, and a chase with
-- nothing to chase is noise.
--
-- Same shape as huddle_at / digest_am_at / digest_pm_at: a plain
-- per-org local time the hourly cron compares itself against, not a
-- second cron job. Defaults are noon and mid-afternoon, matching what
-- was actually asked for.
alter table staff.orgs
  add column if not exists checkin_1_at time not null default '12:00';
alter table staff.orgs
  add column if not exists checkin_2_at time not null default '15:00';

comment on column staff.orgs.checkin_1_at is
  'Local time the first escalating "still not done" reminder goes out -- only to someone who still has something due or late. See app/api/cron/alerts/route.ts.';
comment on column staff.orgs.checkin_2_at is
  'Local time the final, strongest "still not done" reminder goes out. Same targeting as checkin_1_at.';

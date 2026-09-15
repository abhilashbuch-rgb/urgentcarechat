-- The morning huddle: a good-morning email at the start of the day for
-- whoever is actually scheduled to work it. See lib/staff/huddle.ts.
--
-- DEFAULT ON, unlike wants_digest. The owner was explicit: "it should be
-- default for all that work that day" — this isn't a subscription
-- somebody opts into, it's the morning huddle every shift already has
-- informally, just written down and delivered on time. The actual
-- targeting comes from staff.users.workdays (supabase/staff-workdays.sql),
-- not from this switch — a person not scheduled today gets nothing
-- regardless of this column, and this column exists only so a person who
-- genuinely doesn't want it can turn it off for themselves.
alter table staff.users
  add column if not exists wants_morning_huddle boolean not null default true;

comment on column staff.users.wants_morning_huddle is
  'Whether this person gets the 8am morning-huddle email on days staff.users.workdays says they work. Default on — see the header of staff-morning-huddle.sql.';

-- Same shape as digest_am_at / digest_pm_at (staff-alerts.sql): a plain
-- per-org local time the hourly cron compares itself against, not a
-- second cron job. 08:00 because the owner asked for the MAs and front
-- desk to have it "so they know they have to start their day" — before
-- the clinic's own operating_hours_start, not after.
alter table staff.orgs
  add column if not exists huddle_at time not null default '08:00';

comment on column staff.orgs.huddle_at is
  'Local time the morning-huddle email goes out to everyone scheduled to work today. See app/api/cron/alerts/route.ts.';

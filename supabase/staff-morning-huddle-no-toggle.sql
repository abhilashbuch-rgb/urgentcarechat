-- Removes the per-person morning-huddle opt-out. See the header of
-- staff-morning-huddle.sql for why: the owner was explicit there should
-- be no toggle at all, for anyone — the huddle behaves like the EOD
-- report and an excursion alert now, not like the optional digest.
alter table staff.users
  drop column if exists wants_morning_huddle;

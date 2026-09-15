-- ============================================================
-- WHICH DAYS EACH PERSON WORKS — not a clock, a schedule
--
-- Run AFTER supabase/staff-job-roles.sql. Idempotent.
--
-- THIS IS NOT TIME TRACKING. Nobody clocks in or out here, and this
-- column is never read as "is this person on shift right now" for any
-- access-control purpose — it answers one question only: "on a given
-- day, who is expected to be the medical assistant, the front desk,
-- the center admin." A clinic that runs Natalia on Tuesdays and Jamie
-- the rest of the week can say so, and the app can then say so back —
-- see onDutyToday() in lib/staff/roster-today.ts and the "Today" page
-- banner built on it.
--
-- EMPTY MEANS NOT SET, NOT "NEVER WORKS." An admin who has not yet
-- filled this in for someone gets silence, not a false claim that the
-- person is never on duty — see staff-due-weekday.sql's due_weekday
-- for the identical convention (null/empty defers, it never denies).
-- ============================================================

alter table staff.users
  add column if not exists workdays smallint[] not null default '{}';

do $$ begin
  alter table staff.users
    add constraint staff_users_workdays_range
    check (workdays <@ array[1,2,3,4,5,6,7]::smallint[]);
exception when duplicate_object then null;
end $$;

comment on column staff.users.workdays is
  'ISO weekdays (1=Monday..7=Sunday) this person normally works. Empty '
  'means not yet set by an administrator, not "never works" — see '
  'onDutyToday() in lib/staff/roster-today.ts for how this is read.';

-- ============================================================
-- ONE ROW PER MISSED CHECK, NOT PER EMPTY SHIFT
--
-- Corrects staff-shift-miss-alerts.sql's own scope: that file recorded
-- a miss only when an ENTIRE role's entire slot came back with zero
-- logs filed. The actual ask was narrower and more useful — a single
-- specific check going unfiled, attributed to whoever was on duty for
-- it, by name ("missed by Natalia"), the same day it happens. A shift
-- with five required checks and four filed is now exactly as visible
-- as one with zero filed; it no longer takes a total blackout to earn
-- a name.
--
-- staff.shift_misses is empty in production as of this migration (no
-- row has ever qualified under the old, stricter rule), so this is a
-- clean schema change, not a backfill.
--
-- template_id + form_name, NOT job_role alone, is now part of the
-- row's identity: two different missed checks for the same role on
-- the same day (say, both the fridge check and the crash-cart check
-- for medical assistant) are two misses, not one — see
-- lib/staff/shift-miss.ts, the only writer, for the detection query.
-- form_name is a snapshot, not a join at read time: a template can be
-- renamed or retired later, and the record of what was actually missed
-- should not change retroactively when that happens.
-- ============================================================

alter table staff.shift_misses
  add column if not exists template_id uuid references staff.form_templates(id) on delete set null;

alter table staff.shift_misses
  add column if not exists form_name text;

-- Empty today, so no real row needs a value for the not-null rule
-- below to backfill — this is defensive, not a real migration path.
update staff.shift_misses set form_name = 'Unknown' where form_name is null;
alter table staff.shift_misses alter column form_name set not null;

alter table staff.shift_misses drop constraint if exists shift_misses_org_slug_work_date_slot_job_role_key;
alter table staff.shift_misses
  add constraint shift_misses_identity
  unique (org_slug, work_date, slot, job_role, template_id);

-- ============================================================
-- SMS REVERTED TO EXCURSION-ONLY
--
-- staff-shift-miss-sms.sql extended SMS to missed_shift on the theory
-- that it meant a whole shift coming up completely empty. Now that it
-- fires per INDIVIDUAL missed check instead (the actual ask), that
-- reasoning no longer holds — several missed checks a day for one
-- person would retrain everyone to turn SMS off entirely, the exact
-- failure staff-alerts-sms.sql's header warns about. See
-- lib/staff/alerts.ts's SMS_ELIGIBLE_KINDS, now excursion-only again
-- and the actual source of truth; these comments are just kept
-- accurate to match it.
-- ============================================================

comment on column staff.orgs.owner_alert_phone is
  'E.164, e.g. +12155551234. Receives SMS for out-of-range excursions '
  'only -- never digests, clean logs, or a missed check, even a named '
  'one. Leave null to use email alone.';

comment on column staff.orgs.medical_director_alert_phone is
  'E.164, e.g. +12155551234. Receives SMS for out-of-range excursions '
  'only -- never digests, clean logs, or a missed check, even a named '
  'one. Leave null to use email alone.';

drop index if exists staff.staff_alert_queue_sms_pending;
create index if not exists staff_alert_queue_sms_pending
  on staff.alert_queue (org_slug, created_at)
  where kind = 'excursion'
    and (owner_sms_sent_at is null or director_sms_sent_at is null);

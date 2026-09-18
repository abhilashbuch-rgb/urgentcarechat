-- ============================================================
-- SMS EXTENDED TO missed_shift — STILL NOT "EVERYTHING"
--
-- supabase/staff-alerts-sms.sql drew SMS at "excursions only," reasoned
-- from one test: does the delay between an email arriving and being
-- read actually cause damage? A late crash-cart check does not get
-- worse an hour later. An unchecked vaccine fridge does.
--
-- missed_shift (see supabase/staff-shift-miss-alerts.sql) passes that
-- same test. It is not "a late task" — staff.overdue_today's ordinary
-- missed_task alert already covers that, email-only, unchanged. It is
-- an entire role's entire slot filing NOTHING, which can mean the
-- fridge check that would have caught an excursion simply never
-- happened at all. That is the same silent-equipment risk excursion
-- SMS exists for, arguably worse: an excursion at least tells someone
-- something is wrong; a total miss tells them nothing.
--
-- See lib/staff/alerts.ts's SMS_ELIGIBLE_KINDS for the single place
-- this list is now defined — excursion and missed_shift, nothing else.
-- ============================================================

comment on column staff.orgs.owner_alert_phone is
  'E.164, e.g. +12155551234. Receives SMS for out-of-range excursions '
  'and for an entire missed shift (a role''s whole slot filed nothing) '
  '-- never digests, clean logs, or an ordinary single late task. '
  'Leave null to use email alone.';

comment on column staff.orgs.medical_director_alert_phone is
  'E.164, e.g. +12155551234. Receives SMS for out-of-range excursions '
  'and for an entire missed shift (a role''s whole slot filed nothing) '
  '-- never digests, clean logs, or an ordinary single late task. '
  'Leave null to use email alone.';

-- The sweep's pending query now looks for either kind — see the
-- comment on staff_alert_queue_sms_pending's original definition in
-- supabase/staff-alerts-sms.sql. Dropped and recreated rather than
-- altered: Postgres has no ALTER INDEX ... WHERE.
--
-- SCHEMA-QUALIFIED ON THE DROP, DELIBERATELY. An unqualified "drop
-- index if exists" resolves against search_path, not against staff.*
-- just because the table below is qualified — on a connection whose
-- search_path doesn't lead with staff, that DROP silently matches
-- nothing (IF EXISTS swallows the miss) while the index actually
-- being replaced sits untouched in staff, and the CREATE that follows
-- then collides with it. Learned by hitting exactly that error against
-- production before writing this comment.
drop index if exists staff.staff_alert_queue_sms_pending;
create index if not exists staff_alert_queue_sms_pending
  on staff.alert_queue (org_slug, created_at)
  where kind in ('excursion', 'missed_shift')
    and (owner_sms_sent_at is null or director_sms_sent_at is null);

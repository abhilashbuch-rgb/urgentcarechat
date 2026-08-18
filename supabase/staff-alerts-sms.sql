-- ============================================================
-- SMS FOR THE ONE THING THAT CANNOT WAIT
--
-- Run AFTER supabase/staff-alerts.sql. Idempotent.
--
-- EXCURSIONS ONLY. NOT DIGESTS, NOT CLEAN LOGS, NOT LATE TASKS.
-- ------------------------------------------------------------
-- Email already carries everything: the 9am and 5pm digest, the late
-- task, the clean log if a clinic wants them. SMS earns its place only
-- where the delay between "email arrives" and "email is read" is the
-- thing that does the damage.
--
-- That is a vaccine fridge at 49 degrees. Stock is losing potency while
-- nobody looks, and an owner who reads the email at 8pm has lost a day
-- of viability they could have saved at 3pm. Nothing else in this module
-- has that property — a late crash-cart check is bad and is not worse an
-- hour later.
--
-- The rule matters because SMS is the channel with no filter. Somebody
-- who receives an SMS for every log has to turn the channel off
-- entirely, and turning it off takes the fridge alert with it. Same
-- failure as the email digest decision in staff-alerts.sql, but sharper,
-- because there is no folder to put SMS in.
--
-- AND IT SENDS AT ANY HOUR, DELIBERATELY. No quiet hours. An excursion
-- at 3am is the case the channel exists for; a quiet-hours window would
-- hold the one message whose value is entirely in its timing. If that is
-- not wanted, the phone number is left blank and email does the work.
--
-- PHONE NUMBERS ARE NOT PHI HERE. These are two executives' own mobile
-- numbers, supplied by them, for operational alerts about equipment.
-- No patient identifier is ever placed in an SMS body — see the length
-- cap and the composition in lib/staff/alerts.ts.
-- ============================================================

alter table staff.orgs
  add column if not exists owner_alert_phone text;

alter table staff.orgs
  add column if not exists medical_director_alert_phone text;

-- E.164 or nothing. A number in any other shape does not fail loudly at
-- Twilio — it fails as a 400 buried in a queue row, hours after the
-- excursion it was supposed to announce. Validating the shape here means
-- the mistake surfaces when somebody sets the number, which is the
-- moment they can fix it.
do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_alert_phones_e164
    check (
      (owner_alert_phone is null or owner_alert_phone ~ '^\+[1-9][0-9]{7,14}$')
      and (medical_director_alert_phone is null
           or medical_director_alert_phone ~ '^\+[1-9][0-9]{7,14}$')
    );
exception when duplicate_object then null;
end $$;

comment on column staff.orgs.owner_alert_phone is
  'E.164, e.g. +12155551234. Receives SMS for out-of-range excursions only — never digests or clean logs. Leave null to use email alone.';

-- ============================================================
-- SMS DELIVERY STATE, TRACKED SEPARATELY FROM EMAIL
--
-- Four independent outcomes, not one "sent" flag: an owner's email can
-- accept while their SMS is rejected for an unverified number, and a
-- director's SMS can land while their mailbox bounces. Collapsing these
-- would make "was the medical director told" unanswerable in precisely
-- the mixed-failure case where somebody asks it.
-- ============================================================

alter table staff.alert_queue
  add column if not exists owner_sms_sent_at timestamptz;

alter table staff.alert_queue
  add column if not exists director_sms_sent_at timestamptz;

-- The sweep's pending query reads this index. Kept separate from the
-- email one so an alert with email delivered and SMS still pending is
-- still found.
create index if not exists staff_alert_queue_sms_pending
  on staff.alert_queue (org_slug, created_at)
  where kind = 'excursion'
    and (owner_sms_sent_at is null or director_sms_sent_at is null);

-- ============================================================
-- WHAT WAS ACTUALLY DELIVERED, PER CHANNEL
--
-- The answer to "prove the medical director was notified", which is a
-- question asked after something has already gone wrong and is therefore
-- the wrong time to be reconstructing it from four nullable columns.
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break a re-run.
-- ============================================================

drop view if exists staff.alert_delivery cascade;
create view staff.alert_delivery
with (security_invoker = true) as
select
  q.id,
  q.org_slug,
  q.kind,
  q.urgency,
  q.subject,
  q.created_at,
  q.attempts,
  q.last_error,
  (q.owner_sent_at is not null)        as owner_emailed,
  (q.director_sent_at is not null)     as director_emailed,
  (q.owner_sms_sent_at is not null)    as owner_texted,
  (q.director_sms_sent_at is not null) as director_texted,
  -- One word for the row. 'delivered' means at least one channel reached
  -- each configured recipient; 'partial' means somebody was reached and
  -- somebody was not, which is the state that needs a human.
  case
    when q.attempts >= 5
     and q.owner_sent_at is null
     and q.director_sent_at is null      then 'failed'
    when q.owner_sent_at is not null
      or q.director_sent_at is not null
      or q.owner_sms_sent_at is not null
      or q.director_sms_sent_at is not null then
      case
        when q.last_error is null then 'delivered'
        else 'partial'
      end
    else 'pending'
  end as state
from staff.alert_queue q;

grant select on staff.alert_delivery to staff_app;

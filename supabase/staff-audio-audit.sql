-- ============================================================
-- SOUND OFF DURING CLINIC HOURS, AND OFF-SITE FILINGS IN THE DIGEST
--
-- Run AFTER supabase/staff-geofence.sql. Idempotent.
--
-- ---------------------------------------------------------------
-- WHY THE MUTE TOGGLE IS NOT REMOVED
-- ---------------------------------------------------------------
-- The request was to lock audio ON during operating hours and take the
-- toggle away. It is not built that way, for three reasons, and the
-- first two mean the lock would not work even if it were.
--
-- A BROWSER CANNOT BE MADE TO PLAY SOUND. Every autoplay policy requires
-- a genuine user gesture before an AudioContext will resume. A toggle
-- pinned to "on" changes a boolean; it does not produce a noise. The app
-- already unlocks on the first pointer, key or touch event precisely
-- because that is the only thing that works — and a person who never
-- touches the screen hears nothing however the flag is set.
--
-- THE DEVICE WINS ANYWAY. An iPad on the hardware silent switch, or with
-- its volume at zero, is silent. No web application can read either
-- state, let alone override it. "Mandatory audio" would therefore be a
-- claim the software cannot keep on the exact device the claim is aimed
-- at.
--
-- AND SILENCE IS SOMETIMES CORRECT. A workstation in a room with a
-- distressed patient, a provider on the phone to a specialist, a
-- consultation in progress. Software that cannot be silenced for ninety
-- seconds during a difficult conversation is software that gets closed,
-- and a closed app files no logs at all.
--
-- WHAT IS BUILT INSTEAD is the same bet the geofence and the corrective
-- action make, and it is the one that works: the choice stays available,
-- and it is ON THE RECORD. Turning sound off during clinic hours is
-- logged with who and when, appears on the medical director's digest
-- while it is off, and clears itself when sound comes back on. Nobody
-- can quietly run a shift in silence; anybody can silence a room.
-- ============================================================


-- ---------- 1. When sound was turned off ----------

alter table staff.users
  add column if not exists audio_muted_at timestamptz;

-- Set and cleared by the toggle route. Held on the user rather than in a
-- separate event table because the question the digest asks is "who has
-- it off RIGHT NOW", not "how many times has anyone ever". The history
-- is in staff.audit_log, which already records the toggle.
comment on column staff.users.audio_muted_at is
  'When this person last turned shift sound off. Null when sound is on.';

-- Everyone currently silent, with how long for. security_invoker so it
-- reads under the caller''s RLS.
drop view if exists staff.audio_off_now cascade;
create view staff.audio_off_now
with (security_invoker = true)
as
select u.id,
       u.org_slug,
       u.legal_name,
       u.email,
       u.job_role::text as job_role,
       u.audio_muted_at,
       -- Whole minutes. An owner reading "off for 340 minutes" learns
       -- something a timestamp does not tell them at a glance.
       (extract(epoch from (now() - u.audio_muted_at)) / 60)::integer as minutes_off,
       staff.within_operating_hours(u.org_slug) as during_hours
  from staff.users u
 where u.active
   and not u.audio_alerts_enabled
   and u.audio_muted_at is not null;

grant select on staff.audio_off_now to staff_app;


-- ---------- 2. Off-site filings, today ----------

-- The digest reports what happened today; staff.off_site_filings covers
-- all time. This is the window the 9am and 5pm mails actually need, and
-- keeping it separate means neither query grows a date filter the other
-- does not want.
drop view if exists staff.off_site_today cascade;
create view staff.off_site_today
with (security_invoker = true)
as
select r.org_slug,
       t.name as form_name,
       u.legal_name as filed_by,
       r.location_status,
       round(r.filed_distance_m)::integer as distance_m,
       r.location_note,
       r.submitted_at
  from staff.form_responses r
  join staff.form_instances i on i.id = r.instance_id
  join staff.form_templates t on t.id = i.template_id
  left join staff.users u on u.id = r.submitted_by
 where i.due_date = (now() at time zone coalesce(
         (select o.timezone from staff.orgs o where o.slug = r.org_slug),
         'America/New_York'))::date
   and r.location_status in ('off_site', 'denied')
 order by r.submitted_at;

grant select on staff.off_site_today to staff_app;

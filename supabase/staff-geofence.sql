-- ============================================================
-- WHERE A LOG WAS FILED FROM
--
-- Run AFTER supabase/staff-logs.sql and staff-billing.sql. Idempotent.
--
-- THE PROBLEM THIS ACTUALLY SOLVES. A fridge temperature typed from
-- somebody's sofa is not a reading, it is a guess with a signature on
-- it, and it is indistinguishable in the record from an honest one. That
-- is the whole failure mode: not fraud exactly, but a 7am reading
-- entered at 9pm from home because the shift got away from someone.
--
-- WHAT THIS CANNOT DO, STATED FIRST SO NOBODY BUILDS A POLICY ON A
-- PROMISE IT DOES NOT MAKE. Browser geolocation is not attestable. The
-- DevTools sensors panel sets arbitrary coordinates in seconds, phone
-- mock-location apps do the same, and nothing server-side can tell a
-- spoofed fix from a real one — the browser is the only witness and it
-- is the thing under the user's control. Anyone who wants to defeat this
-- will. So this is NOT an access control and must never be described as
-- one.
--
-- WHAT IT IS: provenance on the record. Every filing carries the
-- coordinates it was made from, the accuracy the device claimed, and the
-- computed distance from the clinic. An off-site filing is still filed —
-- refusing it would only move the reading to a later, worse entry — but
-- it is stamped, it needs a written reason, and it appears in front of
-- the owner. The deterrent is that it is on the record, not that it is
-- impossible. That is the same bet the corrective-action rule makes and
-- it is the one that works: people do not quietly do the thing that
-- leaves a labelled trace.
--
-- INDOOR ACCURACY IS WHY THIS DOES NOT FAIL CLOSED. A single-storey
-- clinic with a steel roof and no GPS lock falls back to WiFi
-- positioning, which is commonly 50-150m out and occasionally far
-- worse. A hard block calibrated tight enough to be meaningful would
-- therefore reject real readings taken in a back corridor, and the
-- workaround a blocked MA reaches for is to file from the car park
-- afterwards. A blocked honest reading costs more than a flagged
-- dishonest one.
--
-- PRIVACY. Location is read ONCE, at the moment a log is submitted, and
-- never in the background — there is no tracking here and no column that
-- could hold a trail. Staff are told at the point of collection, every
-- time, not once at onboarding (see LocationStamp.tsx). Several states
-- expect disclosure before employee location is recorded at all, and a
-- notice nobody remembers seeing is not a disclosure.
-- ============================================================

-- ---------- 1. Where the clinic is ----------

alter table staff.orgs add column if not exists latitude  double precision;
alter table staff.orgs add column if not exists longitude double precision;

-- Metres. 150 is a strip-mall clinic plus its car park, with room for
-- the WiFi-positioning error described above. Tighter than about 75 and
-- honest indoor readings start failing.
alter table staff.orgs
  add column if not exists geofence_radius_m integer not null default 150;

-- off     — do not ask for location at all.
-- record  — capture and stamp it; never withhold anything.
-- require — capture and stamp it, and an off-site or unavailable filing
--           must carry a written reason before it can be saved.
--
-- DEFAULTS TO 'record', NOT 'require'. Enforcing a radius before anyone
-- has confirmed the clinic's coordinates are correct would lock out an
-- entire staff over a typo in a longitude. Record first, look at the
-- distances for a week, then tighten.
alter table staff.orgs
  add column if not exists geofence_mode text not null default 'record';

do $$ begin
  alter table staff.orgs add constraint staff_orgs_geofence_mode
    check (geofence_mode in ('off', 'record', 'require'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table staff.orgs add constraint staff_orgs_geofence_radius
    check (geofence_radius_m between 25 and 20000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table staff.orgs add constraint staff_orgs_latlng_range
    check (
      (latitude is null and longitude is null)
      or (latitude between -90 and 90 and longitude between -180 and 180)
    );
exception when duplicate_object then null; end $$;

-- 'require' IS UNREACHABLE WITHOUT COORDINATES. Without this a clinic
-- could switch enforcement on while latitude is still null, at which
-- point every distance is unknown, every filing is "unavailable", and
-- the whole staff is asked for a written excuse on every log. The
-- constraint makes that state unrepresentable rather than merely
-- unlikely.
do $$ begin
  alter table staff.orgs add constraint staff_orgs_require_needs_coords
    check (
      geofence_mode <> 'require'
      or (latitude is not null and longitude is not null)
    );
exception when duplicate_object then null; end $$;


-- ---------- 2. Where the filing came from ----------

alter table staff.form_responses add column if not exists filed_lat        double precision;
alter table staff.form_responses add column if not exists filed_lng        double precision;
-- What the DEVICE claimed, in metres, not what we believe. A fix with a
-- 2000m accuracy radius is not evidence of being anywhere in particular,
-- and storing the claim is what lets that be judged later.
alter table staff.form_responses add column if not exists filed_accuracy_m double precision;
-- Computed server-side from the org's coordinates. Stored rather than
-- derived on read because the clinic can move, and a distance
-- recalculated against a new address would silently rewrite history.
alter table staff.form_responses add column if not exists filed_distance_m double precision;

-- on_site     — inside the radius.
-- off_site    — a usable fix, outside the radius.
-- unavailable — the browser could not produce a fix (no sensor, timeout).
-- denied      — the person refused the permission prompt.
-- not_asked   — the clinic has geofence_mode = 'off'.
--
-- 'denied' and 'unavailable' are kept apart deliberately. Refusing the
-- prompt is a choice and worth seeing; a failed fix in a basement is
-- not, and conflating them would put an ordinary MA in a column that
-- reads like evasion.
alter table staff.form_responses
  add column if not exists location_status text not null default 'not_asked';

alter table staff.form_responses add column if not exists location_note text;

do $$ begin
  alter table staff.form_responses add constraint staff_responses_location_status
    check (location_status in
      ('not_asked', 'on_site', 'off_site', 'unavailable', 'denied'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table staff.form_responses add constraint staff_responses_latlng_range
    check (
      (filed_lat is null and filed_lng is null)
      or (filed_lat between -90 and 90 and filed_lng between -180 and 180)
    );
exception when duplicate_object then null; end $$;

-- A reason, where one is given, has to say something. Twenty characters
-- for the same reason the corrective action needs twenty: "wfh" is worse
-- than blank, because blank reads as unfinished and gets chased while
-- three characters look like an answer. NOT VALID so the constraint
-- binds new rows without rewriting or rejecting history.
do $$ begin
  alter table staff.form_responses add constraint staff_responses_location_note_len
    check (location_note is null or length(btrim(location_note)) >= 20) not valid;
exception when duplicate_object then null; end $$;

-- Distances are only meaningful against a fix that exists.
do $$ begin
  alter table staff.form_responses add constraint staff_responses_distance_needs_fix
    check (filed_distance_m is null or (filed_lat is not null and filed_lng is not null));
exception when duplicate_object then null; end $$;


-- ---------- 3. Distance, once, in the database ----------

-- Haversine. Defined here as well as in lib/staff/geo.ts because the
-- view below needs it in SQL, and two implementations of one formula
-- eventually disagree — so the TypeScript one is what writes the stored
-- value and this one is only ever used for reporting over rows that
-- already have it. IMMUTABLE so it can be indexed and inlined; it reads
-- nothing outside its arguments.
create or replace function staff.distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable parallel safe
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371000 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2))
        * power(sin(radians(lng2 - lng1) / 2), 2)
    ))
  end
$$;

revoke all on function staff.distance_m(double precision, double precision,
                                        double precision, double precision) from public;
grant execute on function staff.distance_m(double precision, double precision,
                                           double precision, double precision) to staff_app;


-- ---------- 4. What the owner looks at ----------

-- Partial index: the interesting rows are the small minority, and a full
-- index on a column that is 'on_site' 99% of the time earns nothing.
create index if not exists staff_responses_off_site
  on staff.form_responses (org_slug, submitted_at desc)
  where location_status in ('off_site', 'denied');

-- CREATE OR REPLACE VIEW can only append columns, so a rebuild has to
-- drop first — see the note in staff-logs.sql. security_invoker so the
-- view is read under the caller's RLS rather than the owner's.
drop view if exists staff.off_site_filings cascade;
create view staff.off_site_filings
with (security_invoker = true)
as
select r.id,
       r.org_slug,
       r.submitted_at,
       t.name              as form_name,
       t.slug              as form_slug,
       u.legal_name        as filed_by,
       r.location_status,
       round(r.filed_distance_m)::integer  as distance_m,
       round(r.filed_accuracy_m)::integer  as accuracy_m,
       o.geofence_radius_m as radius_m,
       r.location_note,
       r.has_out_of_range
  from staff.form_responses r
  join staff.form_instances i on i.id = r.instance_id
  join staff.form_templates t on t.id = i.template_id
  join staff.orgs o           on o.slug = r.org_slug
  left join staff.users u     on u.id = r.submitted_by
 where r.location_status in ('off_site', 'denied', 'unavailable')
 order by r.submitted_at desc;

grant select on staff.off_site_filings to staff_app;

-- Seed the one known clinic's coordinates from the patient-side listing
-- if it happens to be there, so 'record' mode produces real distances on
-- day one instead of a column of nulls. Only fills a null — never
-- overwrites a coordinate an administrator has set by hand, which would
-- undo a correction on every deploy.
update staff.orgs o
   set latitude  = c.lat,
       longitude = c.lng
  from public.clinics c
 where c.tenant_slug = o.slug
   and o.latitude is null
   and c.lat is not null
   and c.lng is not null;

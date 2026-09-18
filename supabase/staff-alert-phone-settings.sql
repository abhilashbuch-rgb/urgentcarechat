-- ============================================================
-- ALERT PHONE NUMBERS, SETTABLE FROM THE SETTINGS PAGE AT LAST
--
-- staff-alerts-sms.sql (owner_alert_phone/medical_director_alert_phone)
-- and staff-shift-miss-sms.sql (extending SMS to missed_shift) both
-- assumed a clinic could actually GET a phone number into those two
-- columns. Nothing did — staff.update_org_settings() only ever took
-- the two email addresses, so the only way to set a phone number was
-- by hand in the SQL editor. A channel nobody can turn on from the
-- product is not a feature; see app/staff/settings/route.ts's own
-- header for the identical argument already made about the email
-- columns before this fix.
--
-- DROP THEN CREATE, NOT CREATE OR REPLACE. Adding parameters changes
-- the function's signature, and Postgres treats a different signature
-- as a different function — CREATE OR REPLACE would have left the old
-- 8-argument version callable and unused rather than removing it.
-- ============================================================

drop function if exists staff.update_org_settings(
  text, text, double precision, double precision, integer, text, text, text
);

create function staff.update_org_settings(
  p_org text, p_timezone text, p_latitude double precision,
  p_longitude double precision, p_radius_m integer, p_mode text,
  p_owner_email text, p_md_email text,
  p_owner_phone text default null, p_md_phone text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if p_timezone !~ '^[A-Za-z]+/[A-Za-z0-9_+-]+$' then
    raise exception 'timezone must be a Region/City name, not %', p_timezone
      using errcode = 'check_violation';
  end if;

  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'latitude and longitude must both be set or both be null'
      using errcode = 'check_violation';
  end if;

  -- Same E.164 shape staff_orgs_alert_phones_e164 already enforces on
  -- the columns themselves — checked here too so a bad number surfaces
  -- as this function's own exception (caught by the route, shown as a
  -- normal form error) rather than as the table constraint's raw
  -- error reaching a page that has no idea what to do with it.
  if p_owner_phone is not null and p_owner_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'owner phone must be E.164, e.g. +12155551234'
      using errcode = 'check_violation';
  end if;
  if p_md_phone is not null and p_md_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'medical director phone must be E.164, e.g. +12155551234'
      using errcode = 'check_violation';
  end if;

  update staff.orgs set
    timezone                     = p_timezone,
    latitude                     = p_latitude,
    longitude                    = p_longitude,
    geofence_radius_m            = p_radius_m,
    geofence_mode                = p_mode,
    owner_alert_email            = nullif(btrim(coalesce(p_owner_email, '')), ''),
    medical_director_alert_email = nullif(btrim(coalesce(p_md_email, '')), ''),
    owner_alert_phone            = nullif(btrim(coalesce(p_owner_phone, '')), ''),
    medical_director_alert_phone = nullif(btrim(coalesce(p_md_phone, '')), '')
  where slug = p_org;

  if not found then
    raise exception 'no such organization: %', p_org
      using errcode = 'no_data_found';
  end if;
end $function$;

grant execute on function staff.update_org_settings(
  text, text, double precision, double precision, integer, text, text, text, text, text
) to staff_app;

-- ============================================================
-- AN OWNER CAN SET THEIR CLINIC'S SETTINGS. ONLY THOSE.
--
-- staff.orgs carries two very different kinds of column on one row:
--
--   the clinic's own settings — timezone, coordinates, geofence, who to
--   alert — which the owner must be able to change; and
--
--   the billing state — is_read_only, subscription_status, trial_ends_on,
--   the Stripe ids — which only the signed webhook may write.
--
-- The RLS policy reflects that: USING lets an administrator READ their
-- own org, WITH CHECK requires a super admin to WRITE it. Correct, and it
-- is why /staff/settings failed with "new row violates row-level security
-- policy for table orgs" the first time it was run against a real
-- database as staff_app.
--
-- WIDENING THE POLICY WOULD BE THE WRONG FIX. Postgres row-level security
-- is row-level, not column-level: a policy permissive enough to let an
-- owner set their timezone would also let them set is_read_only = false
-- and use the product for nothing. So the write goes through a function
-- that can only reach the settings columns, and the billing columns stay
-- unreachable from the application at all.
-- ============================================================

create or replace function staff.update_org_settings(
  p_org        text,
  p_timezone   text,
  p_latitude   double precision,
  p_longitude  double precision,
  p_radius_m   integer,
  p_mode       text,
  p_owner_email text,
  p_md_email    text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Region/City only. 'EST' has no daylight-saving rule and every
  -- reminder and report drifts by an hour for half the year.
  if p_timezone !~ '^[A-Za-z]+/[A-Za-z0-9_+-]+$' then
    raise exception 'timezone must be a Region/City name, not %', p_timezone
      using errcode = 'check_violation';
  end if;

  -- Half a coordinate would place the clinic on the equator or the prime
  -- meridian and stamp every filing thousands of miles from the door.
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'latitude and longitude must both be set or both be null'
      using errcode = 'check_violation';
  end if;

  update staff.orgs set
    timezone                     = p_timezone,
    latitude                     = p_latitude,
    longitude                    = p_longitude,
    geofence_radius_m            = p_radius_m,
    geofence_mode                = p_mode,
    owner_alert_email            = nullif(btrim(coalesce(p_owner_email, '')), ''),
    medical_director_alert_email = nullif(btrim(coalesce(p_md_email, '')), '')
  where slug = p_org;

  if not found then
    raise exception 'no such organization: %', p_org
      using errcode = 'no_data_found';
  end if;
end $$;

revoke all on function staff.update_org_settings(
  text, text, double precision, double precision, integer, text, text, text
) from public;
grant execute on function staff.update_org_settings(
  text, text, double precision, double precision, integer, text, text, text
) to staff_app;

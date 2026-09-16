-- ============================================================
-- REMINDER TIMES, EDITABLE BY THE OWNER — NOT A STAFF PREFERENCE
--
-- huddle_at, digest_am_at, digest_pm_at (staff-alerts.sql /
-- staff-morning-huddle.sql) and checkin_1_at, checkin_2_at
-- (staff-task-followups.sql) have all existed as plain per-org time
-- columns since they shipped, but nothing anywhere let an owner
-- actually change them — they were hand-edit-the-database-only. A
-- clinic whose morning huddle should really go out at 7:30 instead
-- of 8:00 had no way to say so.
--
-- OWNER-ONLY, DELIBERATELY STRICTER THAN THE REST OF /staff/settings
-- (manager-level). Same reasoning as staff-billing-stats.sql's
-- billing_contact_email: these times decide whether an out-of-range
-- reading's escalation, the morning huddle, and both "still not done"
-- notices land when they are supposed to. A field a manager could
-- quietly push back an hour is not a convenience.
--
-- staff.orgs' own RLS requires a super admin to write the row
-- directly (same reason staff.update_org_settings exists at all), so
-- this reaches exactly these five columns through a SECURITY DEFINER
-- function and nothing else on the row.
create or replace function staff.update_reminder_times(
  p_org        text,
  p_huddle_at  text,
  p_digest_am  text,
  p_digest_pm  text,
  p_checkin_1  text,
  p_checkin_2  text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update staff.orgs set
    huddle_at    = p_huddle_at::time,
    digest_am_at = p_digest_am::time,
    digest_pm_at = p_digest_pm::time,
    checkin_1_at = p_checkin_1::time,
    checkin_2_at = p_checkin_2::time
  where slug = p_org;

  if not found then
    raise exception 'no such organization: %', p_org
      using errcode = 'no_data_found';
  end if;
end $$;

revoke all on function staff.update_reminder_times(
  text, text, text, text, text, text
) from public;
grant execute on function staff.update_reminder_times(
  text, text, text, text, text, text
) to staff_app;

-- ============================================================
-- AMENDMENTS, AND A THREE-MINUTE HOLD ON THE ALARM
--
-- staff.form_responses has carried supersedes_id since the first
-- migration and nothing has ever written it. Reading the code that is
-- easy to miss: lib/staff/logs.ts filters on `supersedes_id is null` to
-- find the head of the chain, which looks like a correction path is in
-- use. It is not. Nothing inserts a superseding row, and the partial
-- unique index on (instance_id) where supersedes_id is null means a
-- second filing for the same instance is simply rejected. So a medical
-- assistant who typed 55 instead of 38.5 had no way to fix it at all.
--
-- WHAT IS NOT BUILT HERE, DELIBERATELY: a draft state. "Let them edit
-- until they send it" is an unrecorded editing window, which is the
-- exact hole staff-immutability.sql just closed. A fridge that reads 55
-- and becomes 38.5 before anybody else sees it leaves no evidence that
-- 55 was ever observed, and that evidence is the product.
--
-- So: amending is always allowed and always recorded. The only thing
-- with a clock on it is the ALARM. Three minutes, chosen because a
-- transposed digit is noticed in the same breath while a genuinely warm
-- fridge is still savable; ten minutes of silence on a real excursion
-- costs a vaccine lot and a letter to every patient dosed from it.
-- ============================================================

-- ---------- 1. The hold ----------
alter table staff.alert_queue
  add column if not exists hold_until  timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_reason text;

comment on column staff.alert_queue.hold_until is
  'The sweep will not send before this instant. Null means send now, '
  'which is every alert that is not an amendable excursion.';

-- A cancelled alert is kept, never deleted. "We nearly texted you about
-- a fridge at 55 and then the reading was corrected" is itself
-- information an administrator may want, and the row is the only place
-- it exists.
create index if not exists staff_alert_queue_held
  on staff.alert_queue (org_slug, hold_until)
  where cancelled_at is null and hold_until is not null;

-- ---------- 2. Amending, as one indivisible act ----------
-- SECURITY DEFINER and one function rather than three statements in the
-- route, because the insert and the alert cancellation must not be able
-- to half-happen. A superseding row with the original's alarm still
-- armed texts the director about a value nobody believes any more.
create or replace function staff.amend_response(
  p_org       text,
  p_response  uuid,
  p_user      uuid,
  p_answers   jsonb,
  p_reason    text,
  p_flagged   boolean,
  -- text[], matching the column. Declared as jsonb in the first draft,
  -- which the type checker caught only because this was run against a
  -- real Postgres rather than reasoned about.
  p_out_of_range text[],
  p_corrective   text,
  -- The amendment's OWN location. Passing the original's would assert
  -- that the correction happened where the filing did, which is the kind
  -- of small untruth that discredits a whole record when a surveyor
  -- finds it. Null when the browser would not say.
  p_lat        double precision default null,
  p_lng        double precision default null,
  p_accuracy_m double precision default null,
  p_distance_m double precision default null,
  p_loc_status text default 'not_asked',
  p_loc_note   text default null
) returns table (new_id uuid, alarm_cancelled boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  orig     staff.form_responses;
  fresh_id uuid;
  killed   boolean := false;
begin
  if length(btrim(coalesce(p_reason, ''))) < 20 then
    raise exception 'an amendment needs a reason of at least 20 characters'
      using errcode = 'check_violation';
  end if;

  select * into orig from staff.form_responses
   where id = p_response and org_slug = p_org;
  if not found then
    raise exception 'no such response in this organization'
      using errcode = 'no_data_found';
  end if;

  -- ONLY THE HEAD MAY BE AMENDED. Amending a row that something already
  -- supersedes would fork the chain, and a fork reads exactly like a
  -- deletion when somebody walks it two years later.
  if exists (select 1 from staff.form_responses
              where supersedes_id = p_response) then
    raise exception 'that entry has already been amended; amend the current one'
      using errcode = 'restrict_violation';
  end if;

  insert into staff.form_responses
    (instance_id, org_slug, submitted_by, answers_json, status,
     has_out_of_range, out_of_range_fields, corrective_action,
     filed_lat, filed_lng, filed_accuracy_m, filed_distance_m,
     location_status, location_note,
     supersedes_id, correction_reason)
  values
    (orig.instance_id, p_org, p_user, p_answers,
     case when p_flagged then 'flagged' else 'pending' end,
     p_flagged, p_out_of_range,
     case when p_flagged then p_corrective else null end,
     p_lat, p_lng, p_accuracy_m, p_distance_m,
     coalesce(p_loc_status, 'not_asked'), p_loc_note,
     p_response, btrim(p_reason))
  returning id into fresh_id;

  -- Cancel the original's alarm only while it is still held. Past the
  -- hold the message has gone; marking it cancelled would claim
  -- something false about a mail that is already in somebody's pocket.
  update staff.alert_queue
     set cancelled_at = now(),
         cancelled_reason = 'superseded within the hold: ' || btrim(p_reason)
   where org_slug = p_org
     and source_kind = 'form_response'
     and source_id = p_response
     and cancelled_at is null
     and hold_until is not null
     and hold_until > now()
     and owner_sent_at is null
     and director_sent_at is null;

  killed := found;

  new_id := fresh_id;
  alarm_cancelled := killed;
  return next;
end $$;

-- The old four-and-four signature is dropped, not left beside the new
-- one: a defaulted argument makes a DIFFERENT function, and two
-- overloads of the same name is how provision_trial 500ed every signup.
drop function if exists staff.amend_response(text, uuid, uuid, jsonb, text, boolean, jsonb, text);
revoke all on function staff.amend_response(text, uuid, uuid, jsonb, text, boolean, text[], text, double precision, double precision, double precision, double precision, text, text) from public;
grant execute on function staff.amend_response(text, uuid, uuid, jsonb, text, boolean, text[], text, double precision, double precision, double precision, double precision, text, text) to staff_app;

-- ---------- 3. The live board ----------
-- Everything filed today, newest first, amendments included and marked
-- as such. One query rather than a join the page has to assemble, so the
-- board can poll cheaply.
drop view if exists staff.activity_today cascade;
create view staff.activity_today
with (security_invoker = true) as
select r.id,
       r.org_slug,
       t.name                     as form_name,
       i.slot,
       r.submitted_at,
       u.name                     as filed_by,
       r.status,
       r.has_out_of_range,
       r.corrective_action,
       r.location_status,
       r.filed_distance_m,
       r.location_note,
       r.supersedes_id is not null as is_amendment,
       r.correction_reason,
       -- Null on the head of every chain; set on a row that something
       -- newer has replaced, which is how the board greys it out.
       (select x.id from staff.form_responses x
         where x.supersedes_id = r.id limit 1) as superseded_by
  from staff.form_responses r
  join staff.form_instances i on i.id = r.instance_id
  join staff.form_templates t on t.id = i.template_id
  left join staff.users u on u.id = r.submitted_by
 where r.submitted_at >= now() - interval '36 hours'
 order by r.submitted_at desc;

grant select on staff.activity_today to staff_app;

-- ---------- 4. "The current version" was selecting the ORIGINAL ----------
--
-- This is the bug that would have made every amendment invisible, and it
-- was latent only because nothing ever wrote supersedes_id.
--
-- A correction inserts a row whose supersedes_id points BACKWARDS at the
-- entry it replaces. So the newest row in a chain is the one carrying a
-- supersedes_id, and the oldest — the mistake — is the one with null.
-- Every read path tested `supersedes_id is null`, which selects the
-- ORIGINAL. Switch amendments on without this and the board, the
-- surveyor vault and today's log all keep showing 55°F forever while the
-- correction sits in the table unread.
--
-- The head of a chain is the row that nothing supersedes. That cannot be
-- a partial index, so it is a NOT EXISTS — and staff.amend_response
-- refuses to amend an already-amended row, which keeps every chain
-- linear and this test single-valued.
--
-- The unique index staff_responses_one_live is deliberately left alone:
-- read correctly it says "one ORIGINAL per instance", which is still
-- exactly the double-filing guard it was written to be. Amendments carry
-- a supersedes_id and fall outside it.

drop view if exists staff.todays_logs cascade;
create view staff.todays_logs
with (security_invoker = true) as
select
  t.org_slug,
  t.id            as template_id,
  t.slug,
  t.name,
  t.description,
  t.category,
  t.frequency,
  t.sort_order,
  t.job_roles,
  s.slot,
  r.id            as response_id,
  r.submitted_at,
  r.submitted_by,
  r.has_out_of_range,
  r.supersedes_id is not null as is_amendment,
  u.legal_name    as submitted_by_name,
  u.email         as submitted_by_email
from staff.form_templates t
cross join lateral unnest(
  case when cardinality(t.slots) = 0 then array[''] else t.slots end
) as s(slot)
left join staff.form_instances i
  on i.template_id = t.id and i.due_date = current_date and i.slot = s.slot
left join staff.form_responses r
  on r.instance_id = i.id
 and not exists (
       select 1 from staff.form_responses newer
        where newer.supersedes_id = r.id
     )
left join staff.users u on u.id = r.submitted_by
where t.active;

grant select on staff.todays_logs to staff_app;

-- ---------- 5. Put back what the cascade took ----------
--
-- `drop view staff.todays_logs cascade` also drops staff.overdue_today,
-- which is built on it and drives the missed-task alerts. The cascade is
-- necessary — the view's column list changes, and Postgres will not
-- replace a view whose columns move — but a migration that silently
-- removes the late-task detector and leaves it removed is worse than one
-- that fails. Recreated verbatim from staff-alerts.sql.
create or replace view staff.overdue_today
with (security_invoker = true) as
select
  l.org_slug,
  l.template_id,
  l.slug,
  l.name,
  l.slot,
  l.job_roles,
  (now() at time zone o.timezone)::time as local_now,
  o.timezone
from staff.todays_logs l
join staff.orgs o on o.slug = l.org_slug
where l.response_id is null
  and (
    (l.slot = 'am' and (now() at time zone o.timezone)::time > time '11:00')
    or (l.slot = 'pm' and (now() at time zone o.timezone)::time
          > (o.operating_hours_end - interval '1 hour'))
  );

grant select on staff.overdue_today to staff_app;

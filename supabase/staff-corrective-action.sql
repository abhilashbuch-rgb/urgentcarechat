-- ============================================================
-- A CORRECTIVE ACTION HAS TO SAY SOMETHING
--
-- Run AFTER supabase/staff-logs.sql. Idempotent.
--
-- WHAT WAS WRONG
-- --------------
-- staff-logs.sql required a corrective action on any out-of-range
-- response, at three characters or more. That stopped an empty field
-- and nothing else. Tested by submitting a vaccine fridge at 52 degF
-- with corrective_action "n/a": accepted, flagged, filed.
--
-- The gate itself was never the weak part — it is enforced in the
-- database, so closing the modal, a second tab, or a hand-made request
-- all hit the same wall. The weak part was that the wall was three
-- characters high.
--
-- WHY THIS MATTERS MORE THAN IT SOUNDS. An excursion log reading "n/a"
-- is worse than one with no corrective action at all. A missing entry
-- reads as an incomplete record and gets chased. "n/a" reads as a
-- completed record and gets filed, and is what a surveyor finds three
-- years later next to a temperature that reached 52 degrees.
--
-- TWENTY CHARACTERS, and the number is arbitrary in the way a speed
-- limit is arbitrary. "Moved stock to backup fridge" is 28. "Called
-- McKesson, awaiting viability decision" is 40. "n/a", "ok", "none",
-- "fixed" and "done" are all under it, and those are the five things
-- people actually type when they are in a hurry and the field is in
-- their way.
--
-- ADDED **NOT VALID**, deliberately. This runs against databases that
-- already hold responses written under the old three-character rule,
-- and a plain ADD CONSTRAINT would validate every historical row and
-- fail the migration on the first one. NOT VALID enforces on every
-- INSERT and UPDATE from now on while leaving history alone — which is
-- also the only correct treatment of history here: those entries are
-- signed records of what somebody actually wrote, and rewriting or
-- deleting them to satisfy a rule invented afterwards would be exactly
-- the tampering this module exists to make impossible.
--
-- To see the old thin ones rather than silently carry them:
--   select * from staff.thin_corrective_actions;
-- ============================================================

-- The original three-character rule is a subset of this one, so it stays
-- as the floor and this sits on top. Dropped first so re-running with a
-- different threshold replaces rather than accumulates.
alter table staff.form_responses
  drop constraint if exists staff_response_corrective_substantive;

alter table staff.form_responses
  add constraint staff_response_corrective_substantive
  check (
    corrective_action is null
    or length(btrim(corrective_action)) >= 20
  )
  not valid;

-- What the old rule let through. Not cleaned up — surfaced, so somebody
-- can go and ask the person what actually happened while they still
-- remember, which is the only real fix for a thin entry.
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break a re-run.
drop view if exists staff.thin_corrective_actions cascade;
create view staff.thin_corrective_actions
with (security_invoker = true) as
select
  r.id,
  r.org_slug,
  r.instance_id,
  t.name  as form_name,
  r.submitted_at,
  r.corrective_action,
  length(btrim(r.corrective_action)) as chars,
  r.out_of_range_fields,
  u.legal_name as submitted_by_name
from staff.form_responses r
left join staff.users u on u.id = r.submitted_by
left join staff.form_instances i on i.id = r.instance_id
left join staff.form_templates t on t.id = i.template_id
where r.corrective_action is not null
  and length(btrim(r.corrective_action)) < 20;

grant select on staff.thin_corrective_actions to staff_app;

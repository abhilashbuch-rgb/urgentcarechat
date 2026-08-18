-- ============================================================
-- EMERGENCY ACTION GUIDES
--
-- Run AFTER supabase/staff-rounds.sql. Idempotent.
--
-- WHY THIS IS staff.rounds AND NOT A NEW TABLE
-- --------------------------------------------
-- The brief asked for a Learning tab holding role-filtered emergency
-- checklists: anaphylaxis for the MA, radiation emergency stop for the
-- x-ray tech, STEMI escalation for the provider, active threat for the
-- front desk.
--
-- Structurally that is what staff.rounds already is — an ordered list of
-- imperative steps, scoped to a job, read one at a time. Building a
-- second table with the same shape would mean two step editors, two
-- role filters, two places for a clinic to look, and eventually two
-- answers about what the anaphylaxis procedure says. So this adds one
-- column to distinguish them and reuses everything else.
--
-- WHAT ACTUALLY DIFFERS, AND IT IS ONE THING THAT MATTERS
-- ------------------------------------------------------
-- A round is WALKED and SIGNED: the record is that somebody did it.
--
-- An emergency guide is READ WHILE SOMETHING IS HAPPENING. Nobody signs
-- an attestation during an anaphylaxis. Requiring one would mean the
-- app asks a person to confirm paperwork while a patient is losing an
-- airway, and the honest outcome is that they close the app and never
-- open it in an emergency again — losing the one moment the guide
-- exists for.
--
-- So kind='emergency' guides:
--   * take no attestation and write no run record
--   * show EVERY step at once rather than one behind a Next button
--   * sort by how fast you need them, not alphabetically
--
-- ALL STEPS VISIBLE IS THE OPPOSITE OF THE ROUND RUNNER and it is the
-- correct opposite. The runner hides the next step so the walk cannot be
-- faked from the counter. Here there is nothing to fake and everything
-- to lose: somebody needs to see that step 6 is "call 911" before they
-- have finished step 1, and a paginated emergency procedure is a
-- procedure that gets abandoned.
-- ============================================================

alter table staff.rounds
  add column if not exists kind text not null default 'round';

do $$ begin
  alter table staff.rounds
    add constraint staff_rounds_kind_known
    check (kind in ('round', 'emergency'));
exception when duplicate_object then null;
end $$;

comment on column staff.rounds.kind is
  'round = walked and signed, one step at a time. emergency = read during an incident, all steps visible, no attestation.';

-- Nothing may file a run against an emergency guide. The app does not
-- offer it, and this makes that true regardless of what the app does —
-- an attestation that somebody "completed" an anaphylaxis is a record
-- of paperwork, not of care, and would sit in the same table as records
-- that mean something.
create or replace function staff.round_runs_reject_emergency()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from staff.rounds r
     where r.id = new.round_id and r.kind = 'emergency'
  ) then
    raise exception 'emergency guides are read, not signed for'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists staff_round_runs_no_emergency on staff.round_runs;
create trigger staff_round_runs_no_emergency
  before insert on staff.round_runs
  for each row execute function staff.round_runs_reject_emergency();

-- The board splits on kind, so /staff/rounds keeps showing rounds and
-- /staff/learning shows guides, from one view.
--
-- Dropped first rather than CREATE OR REPLACE: replace can only APPEND
-- columns, and kind belongs beside the other descriptive columns.
drop view if exists staff.round_board cascade;
create view staff.round_board
with (security_invoker = true) as
select
  r.id,
  r.org_slug,
  r.key,
  r.kind,
  r.job_roles,
  r.title,
  r.purpose,
  r.cadence,
  r.sort_order,
  (select count(*) from staff.round_steps s where s.round_id = r.id)::int
    as step_count,
  last_run.completed_at as last_walked_at,
  last_run.walker       as last_walked_by,
  jsonb_array_length(coalesce(last_run.exceptions, '[]'::jsonb))::int
    as last_exception_count
from staff.rounds r
left join lateral (
  select ru.completed_at, ru.exceptions, u.legal_name as walker
    from staff.round_runs ru
    left join staff.users u on u.id = ru.walked_by
   where ru.round_id = r.id
   order by ru.completed_at desc
   limit 1
) last_run on true
where r.active;

grant select on staff.round_board to staff_app;

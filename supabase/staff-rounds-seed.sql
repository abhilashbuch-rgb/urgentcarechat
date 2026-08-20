-- ============================================================
-- ROUNDS — seed
--
-- Run AFTER supabase/staff-rounds.sql. Idempotent; safe to re-run.
--
-- FIVE FRONT-DESK ROUNDS, grouped by when they are walked rather than by
-- subject: hourly, at open, at close, and the two that are triggered by
-- something happening. That is the grouping the person uses. A round
-- filed under "infection control" is a round nobody opens at 2pm.
--
-- HOUSE STYLE FOR A STEP. One action, imperative, no preamble, no
-- explanation of why unless the why changes what you do. "Wipe the
-- signature pad" — not "Ensure that signature pads are being sanitized
-- between patient uses." Read standing up, with something in the other
-- hand. The detail line exists only where the instruction alone is
-- ambiguous, and it is a fragment, not a paragraph.
--
-- ORDER IS THE WALK, NOT THE TOPIC. Steps run front door inward and back
-- out, so following them in order is a single loop rather than four trips
-- past the same chair.
-- ============================================================

create or replace function staff.seed_rounds(p_slug text)
returns integer language plpgsql as $$
declare
  n integer := 0;
  r record;
  rid uuid;
begin
  -- ---------- the rounds ----------
  insert into staff.rounds (org_slug, key, job_roles, title, purpose, cadence, sort_order)
  select p_slug, d.key, array['front_desk']::staff.job_role[],
         d.title, d.purpose, d.cadence, d.sort_order
  from (values
    ('fd-hourly-lobby',
     'Hourly lobby round',
     'Restrooms, seating, kiosks, stock. One loop, front door and back.',
     'every hour', 10),
    ('fd-open',
     'Opening the front of house',
     'Doors, alarms, screens, drawer. Before the first patient.',
     'at open', 20),
    ('fd-close',
     'Closing the front of house',
     'Drawer, terminals, doors, mail. After the last patient.',
     'at close', 30),
    ('fd-spill',
     'Spill in the lobby',
     'Isolate first. Body fluids are never yours to clean.',
     'when it happens', 40),
    ('fd-deteriorating',
     'Patient in the lobby looks worse',
     'Do not assess. Get clinical staff now.',
     'when it happens', 50)
  ) as d(key, title, purpose, cadence, sort_order)
  where not exists (
    select 1 from staff.rounds x where x.org_slug = p_slug and x.key = d.key
  );
  get diagnostics n = row_count;

  -- ---------- the steps ----------
  --
  -- Inserted per round and only when that round has none, so re-running
  -- neither duplicates steps nor overwrites a clinic's edits.
  for r in select id, key from staff.rounds where org_slug = p_slug loop
    rid := r.id;
    if exists (select 1 from staff.round_steps s where s.round_id = rid) then
      continue;
    end if;

    if r.key = 'fd-hourly-lobby' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (rid, 1,  'Look at the waiting room before you touch anything.',
                  'Anyone pale, sweating, breathing hard, or slumped — stop this round and get clinical staff.'),
        (rid, 2,  'Restock the door station.', 'Masks, hand sanitiser, tissues.'),
        (rid, 3,  'Wipe the check-in counter, both kiosks, and the signature pad.',
                  'EPA-registered wipes. Let the surface stay wet the full contact time on the canister.'),
        (rid, 4,  'Reset the pen bins.', 'Used bin emptied and wiped, sanitised bin refilled. Never one bin.'),
        (rid, 5,  'Restock the counter.', 'Intake forms, HIPAA notices, visitor badges, receipt paper.'),
        (rid, 6,  'Wipe chair arms and the door handles between the lobby and the desk.', null),
        (rid, 7,  'Clear the lobby.', 'Tissues, masks, cups, magazines off the floor and seats.'),
        (rid, 8,  'Empty any lobby bin that is more than three-quarters full.',
                  'Do not wait for it to overflow — it is a full bin patients photograph.'),
        (rid, 9,  'Check both public restrooms.',
                  'Soap, paper towels, toilet paper, bin. Wet floor or worse: stop and report it on this step.'),
        (rid, 10, 'Check the water station.', 'Cups stocked, counter dry, no leak under the dispenser.'),
        (rid, 11, 'Check temperature, lighting, and the screens.',
                  'Every bulb working. Screens on approved content — never news, never a personal account.'),
        (rid, 12, 'Walk the entryway outside.', 'Litter, ice, standing water, anything somebody trips on.');

    elsif r.key = 'fd-open' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (rid, 1, 'Disarm the alarm.', null),
        (rid, 2, 'Walk the exterior entry before you unlock.',
                 'Ice, water, litter, damage, anything left overnight at the door.'),
        (rid, 3, 'Unlock the exterior doors.', null),
        (rid, 4, 'Power on both intake kiosks and the waiting-room screens.',
                 'Confirm the screens land on approved content, not a desktop.'),
        (rid, 5, 'Count the opening cash drawer and record the float.', null),
        (rid, 6, 'Confirm the card terminal connects.', 'Run a test connection, not a test charge.'),
        (rid, 7, 'Stock the counter and the door station for the morning.',
                 'Forms, notices, badges, receipt paper, masks, sanitiser.'),
        (rid, 8, 'Walk the hourly lobby round once before the doors see a patient.', null);

    elsif r.key = 'fd-close' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (rid, 1, 'Confirm the last patient has left the lobby and the restrooms.',
                 'Look. Do not assume.'),
        (rid, 2, 'Balance the drawer and reconcile the day''s ledger.',
                 'A variance is reported tonight, not carried to tomorrow.'),
        (rid, 3, 'Settle and secure the card terminal.', null),
        (rid, 4, 'Secure the drawer per clinic policy.', null),
        (rid, 5, 'Secure incoming mail and packages out of the lobby.',
                 'Nothing with a patient name on it left on the counter overnight.'),
        (rid, 6, 'Power down kiosks and screens.', null),
        (rid, 7, 'Clear and wipe the lobby and the counter.', null),
        (rid, 8, 'Lock the exterior doors.', null),
        (rid, 9, 'Arm the alarm and confirm it set.', null);

    elsif r.key = 'fd-spill' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (rid, 1, 'Stand where nobody can walk into it and keep people back.',
                 'You are the barrier until there is a real one.'),
        (rid, 2, 'Decide what it is.',
                 'Blood, vomit, urine, or anything you are unsure about is a body fluid. Water and coffee are not.'),
        (rid, 3, 'Body fluid: call environmental services or clinical staff now. Do not clean it.',
                 'Spill kit and PPE, by someone trained in it. This is not a front-desk task.'),
        (rid, 4, 'Water or drink: put the wet-floor sign out, then mop it.', null),
        (rid, 5, 'Stay until the area is dry or handed over.',
                 'A sign on a wet floor with nobody watching it is not control of the hazard.');

    elsif r.key = 'fd-deteriorating' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (rid, 1, 'Say it out loud to clinical staff now.',
                 'Describe what you see — pale, sweating, short of breath, slumped. Do not interpret it.'),
        (rid, 2, 'Stay with the patient until clinical staff arrive.', null),
        (rid, 3, 'Do not take vitals, assess, or advise.',
                 'Watching and reporting is your job here and it is the part that matters.'),
        (rid, 4, 'If they collapse or stop responding, call for help and start the emergency response.',
                 'Anyone can call a code. You will never be criticised for calling one that turned out to be nothing.'),
        (rid, 5, 'Clear a path from the lobby to the treatment area.', null);
    end if;
  end loop;

  return n;
end $$;

grant execute on function staff.seed_rounds(text) to staff_app;

create or replace function staff.rounds_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_rounds(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_rounds on staff.orgs;
create trigger staff_orgs_seed_rounds
  after insert on staff.orgs
  for each row execute function staff.rounds_seed_new_org();

do $$
declare o record;
begin
  for o in select slug from staff.orgs loop
    perform staff.seed_rounds(o.slug);
  end loop;
end $$;

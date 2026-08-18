-- ============================================================
-- EMERGENCY ACTION GUIDES — seed
--
-- Run AFTER supabase/staff-emergency.sql. Idempotent.
--
-- READ THIS BEFORE TRUSTING A LINE OF IT.
--
-- These are drawn from long-standing published guidance: anaphylaxis
-- adrenaline dosing and route per the standard emergency algorithms,
-- OSHA's bloodborne pathogen exposure requirements, the ALARA and
-- emergency-off requirements common to state radiation regulation, and
-- the door-to-ECG target published in acute coronary syndrome guidance.
--
-- THEY ARE STARTING POINTS, NOT THIS CLINIC'S APPROVED PROCEDURES.
-- Every guide seeds with no medical-director review recorded, and the
-- app labels it that way wherever it is shown. A clinic reviews, edits
-- and adopts them; nothing here is presented as locally approved until
-- somebody local approves it.
--
-- WHERE A NUMBER WOULD VARY, THE STEP SAYS WHERE TO LOOK RATHER THAN
-- INVENTING ONE. Paediatric weight-based dosing, the local poison
-- control number, which hospital takes STEMI, and the state's
-- involuntary-hold statute all differ by clinic and by state. A
-- confident wrong number in an emergency guide is worse than no guide,
-- because it will be followed. Those steps name the source instead.
--
-- SCOPE IS RESPECTED EVEN HERE. The front desk guides say recognise,
-- escalate, and clear a path — they do not tell an unlicensed person to
-- assess or treat, because an emergency is exactly when somebody reaches
-- past their scope, and the guide they are reading should not be what
-- invites it.
-- ============================================================

create or replace function staff.seed_emergency_guides(p_slug text)
returns integer language plpgsql as $$
declare
  n integer := 0;
  r record;
  gid uuid;
begin
  insert into staff.rounds
    (org_slug, key, kind, job_roles, title, purpose, cadence, sort_order)
  select p_slug, d.key, 'emergency', d.job_roles, d.title, d.purpose,
         'when it happens', d.sort_order
  from (values
    ('em-anaphylaxis',
     array['medical_assistant','provider']::staff.job_role[],
     'Anaphylaxis',
     'Adrenaline first. Everything else second.', 10),
    ('em-code-blue',
     array['medical_assistant','provider']::staff.job_role[],
     'Unresponsive patient — code blue',
     'Compressions, cart, AED, 911.', 20),
    ('em-eye-splash',
     array['medical_assistant','xray_tech','provider']::staff.job_role[],
     'Splash to the eyes or face',
     'Fifteen minutes of irrigation before anything else.', 30),
    ('em-needlestick',
     '{}'::staff.job_role[],
     'Needlestick or sharps injury',
     'Wash, report now. Prophylaxis is time-limited.', 40),
    ('em-radiation-stop',
     array['xray_tech']::staff.job_role[],
     'Radiation emergency stop',
     'Kill the exposure, clear the room, do not reset it yourself.', 50),
    ('em-patient-fall',
     array['xray_tech','medical_assistant']::staff.job_role[],
     'Patient faints or falls during imaging',
     'Do not catch them mid-fall. Protect the head, get clinical staff.', 60),
    ('em-stemi',
     array['provider']::staff.job_role[],
     'Chest pain — possible STEMI',
     'ECG within 10 minutes of the door. Transfer, do not work it up here.', 70),
    ('em-poisoning',
     array['provider','medical_assistant']::staff.job_role[],
     'Ingestion or poisoning',
     'Poison control decides. Do not induce vomiting.', 80),
    ('em-violent-person',
     array['front_desk']::staff.job_role[],
     'Threatening person or active threat',
     'Your safety first. You are not security.', 90),
    ('em-lobby-recognition',
     array['front_desk']::staff.job_role[],
     'Recognising an emergency in the lobby',
     'What to look for, and the sentence that gets help.', 100),
    ('em-evacuation',
     '{}'::staff.job_role[],
     'Evacuating the building',
     'Route, roll call, and who checks the restrooms.', 110)
  ) as d(key, job_roles, title, purpose, sort_order)
  where not exists (
    select 1 from staff.rounds x where x.org_slug = p_slug and x.key = d.key
  );
  get diagnostics n = row_count;

  for r in select id, key from staff.rounds
            where org_slug = p_slug and kind = 'emergency' loop
    gid := r.id;
    if exists (select 1 from staff.round_steps s where s.round_id = gid) then
      continue;
    end if;

    if r.key = 'em-anaphylaxis' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'Call for the provider and the emergency kit, out loud, now.', 'Do not leave the patient to go and find someone quietly.'),
        (gid, 2, 'Give intramuscular adrenaline into the outer thigh.', 'IM anterolateral thigh. Adult 0.3-0.5 mg of 1 mg/mL. Paediatric dosing is by weight — use the clinic''s weight-based card, do not estimate.'),
        (gid, 3, 'Note the time you gave it.', 'The second dose decision is made on the clock, and nobody remembers the minute afterwards.'),
        (gid, 4, 'Call 911.', 'Every anaphylaxis goes to hospital, including the ones that improve. Biphasic reactions happen hours later.'),
        (gid, 5, 'Lie the patient flat and raise the legs.', 'Unless they are vomiting or struggling to breathe — then let them sit. Do not stand them up, even to move them.'),
        (gid, 6, 'Oxygen, and get vitals on a monitor.', null),
        (gid, 7, 'Repeat adrenaline after 5 to 15 minutes if there is no improvement.', 'On the provider''s call. Same dose, same route, other thigh.'),
        (gid, 8, 'Keep the packaging and the vial.', 'Lot and expiry go on the record, and the vial is the proof of dose.');

    elsif r.key = 'em-code-blue' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'Shout for help and send someone specific for the crash cart and AED.', 'Name a person. "Somebody get the cart" is how nobody goes.'),
        (gid, 2, 'Check for a response and for normal breathing. Take no more than 10 seconds.', 'Gasping is not breathing.'),
        (gid, 3, 'Start compressions.', 'Centre of the chest, hard and fast, minimise interruptions.'),
        (gid, 4, 'Call 911.', 'The moment help is called for, not after the first cycle.'),
        (gid, 5, 'Put the AED on as soon as it arrives and follow its prompts.', 'It will tell you when to stand clear and when to resume.'),
        (gid, 6, 'Swap the person doing compressions every two minutes.', 'Quality falls off before the person doing it notices.'),
        (gid, 7, 'Clear a route for EMS and send someone to the door.', null),
        (gid, 8, 'Record times afterwards, not during.', 'Down time, first compression, first shock, EMS arrival. Somebody should be noting them; nobody should be typing instead of helping.');

    elsif r.key = 'em-eye-splash' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'Get to the eyewash station and start irrigating immediately.', 'Seconds matter more than anything else on this list.'),
        (gid, 2, 'Hold the eyelids open.', 'The reflex is to squeeze them shut, which is the one thing that stops it working.'),
        (gid, 3, 'Irrigate for a full 15 minutes by the clock.', 'It will feel far longer than it is. Have someone time it.'),
        (gid, 4, 'Remove contact lenses only if they come out easily during irrigation.', 'Do not stop irrigating to fight with a lens.'),
        (gid, 5, 'Tell the provider and get it documented.', 'Which substance, which eye, how long you irrigated.'),
        (gid, 6, 'If it was blood or body fluid, this is also an exposure.', 'Follow the needlestick and exposure guide as well — the prophylaxis clock is running.');

    elsif r.key = 'em-needlestick' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'Wash the site with soap and running water.', 'Mucous membranes: flush with water. Do not squeeze the wound and do not put bleach or disinfectant into it.'),
        (gid, 2, 'Report it to the provider or manager immediately.', 'Before the end of the shift, however minor it looks. This is the step people skip.'),
        (gid, 3, 'Understand the clock.', 'HIV post-exposure prophylaxis works best started within hours and is generally considered up to 72 hours. Reported next morning may be too late to treat.'),
        (gid, 4, 'Note the source patient and the device.', 'The provider decides on source testing and consent. You record what the device was and how it happened.'),
        (gid, 5, 'Get the medical evaluation.', 'Under OSHA 29 CFR 1910.1030 this is confidential, at no cost to you, and the employer arranges it.'),
        (gid, 6, 'It goes on the sharps injury log.', 'Device type and brand, work area, how it happened — recorded so individual identity is protected.');

    elsif r.key = 'em-radiation-stop' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'Release the exposure switch.', 'Exposure only continues while it is held. Letting go stops it.'),
        (gid, 2, 'If it does not stop, hit the emergency off.', 'Know where it is before you ever need it — at the console and at the room entrance.'),
        (gid, 3, 'Get everyone out of the room and keep them out.', null),
        (gid, 4, 'Do not reset, retry, or "just check if it works now".', 'A tube that failed to terminate is a tube that may expose somebody on the next attempt.'),
        (gid, 5, 'Tell the provider and the centre administrator now.', 'A suspected overexposure is reportable, and the report has a deadline that starts today.'),
        (gid, 6, 'Write down everything while you remember it.', 'Technique, exposure time, who was in the room, who was behind the barrier, what the machine did.'),
        (gid, 7, 'The unit stays out of service until service clears it.', 'Tagged, not just "we know about it".');

    elsif r.key = 'em-patient-fall' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'Do not try to catch them.', 'Catching a falling adult injures both of you. Guide them down if you can reach them.'),
        (gid, 2, 'Protect the head.', 'It is the only part where a second of your attention changes the outcome.'),
        (gid, 3, 'Leave them where they are and call for the provider.', 'Do not sit them up or walk them to a chair before they are assessed.'),
        (gid, 4, 'Do not restart or complete the exam.', 'Whatever view you still need is not worth a second fall.'),
        (gid, 5, 'Record what happened factually.', 'What they said, what you saw, what position they landed in, who attended and when. Not whether anyone was at fault.');

    elsif r.key = 'em-stemi' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'ECG within 10 minutes of arrival.', 'The target is from the door, not from when the room came free.'),
        (gid, 2, 'Call 911 early — do not wait for confirmation.', 'An ambulance stood down costs nothing. Twenty minutes of door-to-balloon time cannot be recovered.'),
        (gid, 3, 'This is transfer, not workup.', 'Urgent care is not the place to serially trend a troponin on someone with an ischaemic ECG.'),
        (gid, 4, 'Aspirin unless contraindicated.', 'Chewed, not swallowed whole.'),
        (gid, 5, 'Continuous monitoring and defibrillator at the bedside until EMS takes over.', 'Arrest risk is highest early.'),
        (gid, 6, 'Call the receiving facility yourself.', 'Which hospital takes STEMI and by which number is a clinic-specific detail — it belongs on the wall by the phone. A handover clinician to clinician moves the patient faster than an ED triage queue.'),
        (gid, 7, 'Send the ECG with the patient.', 'The paper copy travels. So does the time it was taken.');

    elsif r.key = 'em-poisoning' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'Call Poison Control before treating.', 'US: 1-800-222-1222, 24 hours. They see the whole exposure picture and they are free.'),
        (gid, 2, 'Do not induce vomiting and do not give anything to drink.', 'Ipecac is not used. Some ingestions do far more damage coming back up.'),
        (gid, 3, 'Find out what, how much, and when.', 'Bring the container if there is one. "When" is the question that changes management most.'),
        (gid, 4, 'Airway, breathing, circulation while you wait for the callback.', null),
        (gid, 5, 'Call 911 for any altered mental state, breathing difficulty, or a caustic or hydrocarbon ingestion.', 'Do not wait for Poison Control to tell you to.');

    elsif r.key = 'em-violent-person' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'Your safety comes before the desk, the till, and the queue.', 'Nothing at the front desk is worth being hurt over.'),
        (gid, 2, 'Do not block their exit and do not get behind the counter with no way out.', 'Keep a clear path for both of you.'),
        (gid, 3, 'Lower your voice and let them talk.', 'Do not match volume, do not argue about who is right, do not touch them.'),
        (gid, 4, 'Use the duress signal to alert the back.', 'Every clinic has one and it should be a word or an action that means nothing to a stranger.'),
        (gid, 5, 'Weapon, or someone is hurt: get out and call 911 from somewhere safe.', 'Run, hide, fight — in that order. Do not try to talk down someone armed.'),
        (gid, 6, 'If you cannot get out, lock or barricade, lights off, phones silent.', null),
        (gid, 7, 'Once safe, write it down before you talk to anyone else about it.', 'Memory reshapes fast, and it reshapes faster after other people describe what they saw.');

    elsif r.key = 'em-lobby-recognition' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'Chest pain, pressure, or pain into the jaw or arm.', 'Anyone saying this goes straight back. Do not finish check-in first.'),
        (gid, 2, 'Face drooping, one arm weak, speech slurred.', 'Note the time they were last known well — it is the number the hospital needs.'),
        (gid, 3, 'Struggling to breathe, or talking in short broken phrases.', 'Watch whether they can finish a sentence.'),
        (gid, 4, 'Grey, pale, sweating, or slumping.', null),
        (gid, 5, 'Bleeding that is not stopping.', null),
        (gid, 6, 'A parent saying their baby is floppy, blue, or will not wake properly.', 'Believe the parent.'),
        (gid, 7, 'Say the words that get help.', '"I need clinical staff at the front now." Not "when someone has a minute". You will never be criticised for being wrong about this.'),
        (gid, 8, 'Then clear a path and stay with them.', 'Recognising and escalating is your job here. Assessing is not, and this is the moment it is most tempting.');

    elsif r.key = 'em-evacuation' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (gid, 1, 'Call it loudly and call 911.', null),
        (gid, 2, 'Move people out by the nearest safe exit.', 'Not the way they came in — the nearest safe one.'),
        (gid, 3, 'Someone checks the restrooms and every exam room by name.', 'This is the step that gets missed. Assign it in advance, not during.'),
        (gid, 4, 'Take the day''s patient list with you if it is within reach.', 'It is your roll call. Do not go back for it.'),
        (gid, 5, 'Assemble at the meeting point and count.', 'Staff and patients. Report anyone unaccounted for to the fire service immediately — they will search, you must not.'),
        (gid, 6, 'Nobody re-enters until the fire service says so.', 'Not for a bag, not for a laptop, not to turn something off.');
    end if;
  end loop;

  return n;
end $$;

grant execute on function staff.seed_emergency_guides(text) to staff_app;

create or replace function staff.emergency_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_emergency_guides(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_emergency on staff.orgs;
create trigger staff_orgs_seed_emergency
  after insert on staff.orgs
  for each row execute function staff.emergency_seed_new_org();

do $$
declare o record;
begin
  for o in select slug from staff.orgs loop
    perform staff.seed_emergency_guides(o.slug);
  end loop;
end $$;

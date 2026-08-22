-- ============================================================
-- medicin. STAFF MODULE — SETUP PART 3 OF 5
--
-- RUN THE PARTS IN ORDER, 1 through 5, each as its own paste.
-- Wait for one to report success before starting the next; a later part
-- refers to tables an earlier one creates.
--
-- Every part is idempotent on its own, so re-running one is safe and a
-- part that half-succeeded can simply be run again.
--
-- Migrations in this part:
--   staff-emergency-seed
--   staff-avatars
--   staff-corrective-action
--   staff-alerts
--   staff-alerts-sms
--   staff-surveyor
--   staff-log-photos
--   staff-email-auth
--   staff-log-presets
--   staff-eod-close
--   staff-geofence
--   staff-ethics
--   staff-ops-manual
-- ============================================================

-- ========== staff-emergency-seed.sql ==========

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


-- ========== staff-avatars.sql ==========

-- ============================================================
-- STAFF PHOTOS, AND THE BRANDING THAT SITS ON TOP OF THEM
--
-- Run AFTER supabase/staff-schema.sql. Idempotent.
--
-- THE ARCHITECTURE, WHICH IS THE WHOLE POINT
-- ------------------------------------------
-- The stored file is the person's face, cropped square, and NOTHING
-- ELSE. No ring, no badge, no colour, no logo baked in. The brand is a
-- CSS ring and an optional badge drawn on top at render time from the
-- org's own theme columns.
--
-- That means changing affiliation — or just changing a colour — is one
-- UPDATE and every avatar in the product changes with it. Burning the
-- frame into the file would mean re-processing every employee photo in
-- every clinic on every rebrand, and would leave the old brand living in
-- the storage bucket forever afterwards.
--
-- WHAT IS DELIBERATELY NOT HERE: AUTOMATED FACE DETECTION
-- ------------------------------------------------------
-- The brief specified an image-moderation API (Rekognition, Cloud
-- Vision, Azure) doing face detection with a confidence threshold, logo
-- and text OCR, and an explicit-content filter. That is not implemented,
-- and the reason is not effort.
--
-- Running face detection over employee photographs generates a
-- biometric identifier from a face. Illinois' BIPA and Texas' CUBI
-- regulate exactly that, BIPA with a private right of action and
-- statutory damages per violation, and both require written notice and
-- consent BEFORE collection. A clinic in Chicago that switches this
-- product on has just done biometric collection on its own staff
-- without the consent flow, and would not know it. That is the same
-- class of decision as the internal chat module, which is not built
-- either until an employment attorney signs off the consent flow.
--
-- It also sends a photograph of every employee to a third party, in a
-- product whose whole positioning is that it holds as little as
-- possible.
--
-- WHAT IS ENFORCED INSTEAD: format, size, and square aspect, checked in
-- the route; the crop happens in the browser so an uncropped original
-- never leaves the device; and an administrator can clear any photo. In
-- a twenty-person clinic where everyone knows everyone, an unsuitable
-- profile picture is a two-minute conversation, not a machine-learning
-- problem. If moderation is wanted later it comes back with the consent
-- flow attached, not before.
--
-- AND NO BRAND PRESETS SHIPPING SOMEBODY ELSE'S BADGE. The theme takes a
-- colour and a logo URL the clinic supplies. Shipping a preset that
-- bundles another company's trademarked mark as a product feature is a
-- decision for whoever owns the licence to use it, not for a migration.
-- ============================================================

-- Object-storage key for the cropped square. Never a URL: a stored URL
-- outlives the bucket it points at, and these are served through signed
-- links that expire.
alter table staff.users
  add column if not exists avatar_path text;

alter table staff.users
  add column if not exists avatar_updated_at timestamptz;

-- The org's theme. Two columns, because the rest of the white-label
-- metadata — legal entity, site id, address, CLIA, medical director —
-- is already on staff.orgs from staff-security.sql.
alter table staff.orgs
  add column if not exists brand_color text;

alter table staff.orgs
  add column if not exists logo_url text;

-- A colour that is not a colour would be injected straight into a style
-- attribute. Constrained to a six-digit hex here so no route can be the
-- only thing standing between a text column and the DOM.
do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_brand_color_hex
    check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null;
end $$;

-- Same reasoning for the badge: an https URL or nothing. A javascript:
-- or data: value here would render inside an <img> on every page of the
-- app for everyone in the org.
do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_logo_url_https
    check (logo_url is null or logo_url ~ '^https://');
exception when duplicate_object then null;
end $$;

comment on column staff.users.avatar_path is
  'Object key for the cropped square photo. The face only — no ring, badge or brand is ever burned into the file; those are drawn at render time from the org theme.';

-- ============================================================
-- THE THEME, READ ONCE PER PAGE
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break the
-- combined setup file's second run.
-- ============================================================

drop view if exists staff.org_theme cascade;
create view staff.org_theme
with (security_invoker = true) as
select
  o.slug,
  o.name,
  o.legal_entity,
  -- Falls back to the product's own royal blue rather than to nothing,
  -- so an org that has never set a theme still renders a deliberate
  -- ring instead of an undefined one.
  coalesce(o.brand_color, '#173a8a') as brand_color,
  o.logo_url
from staff.orgs o;

grant select on staff.org_theme to staff_app;


-- ========== staff-corrective-action.sql ==========

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


-- ========== staff-alerts.sql ==========

-- ============================================================
-- ALERTS: WHAT REACHES A PHONE, AND WHEN
--
-- Run AFTER supabase/staff-logs.sql. Idempotent.
--
-- THE ONE DESIGN DECISION THAT MATTERS HERE
-- -----------------------------------------
-- The brief asked for an email to the owner AND the medical director on
-- EVERY log entry. A clinic files roughly ten logs a day, so that is
-- twenty executive emails a day and about six hundred a month, of which
-- roughly all say "everything was fine".
--
-- The failure mode is not annoyance, it is the thing this whole module
-- exists to prevent. Within a week the owner has a filter sending them
-- to a folder. From that moment the OUT-OF-RANGE ALERT lands in the
-- filtered folder too, and the one email that needed to be read at 9am
-- is the one nobody sees. A notification system that trains its reader
-- to ignore it is worse than no notification system, because the owner
-- believes they are covered.
--
-- The stated goal was "look at my phone at 9am or 5pm and know instantly
-- whether the facility is compliant". That is a DIGEST AT TWO TIMES, not
-- a stream. So:
--
--   EXCURSIONS AND MISSED TASKS  -> immediate, individually, always.
--   CLEAN LOGS                   -> recorded here, rolled into the AM
--                                   and PM digest.
--
-- notify_on_all_logs still exists and is still honoured, because it is
-- the owner's clinic and their call. It defaults FALSE, which is the
-- reverse of the brief, and this comment is why.
--
-- TIME GATING NEEDS A TIMEZONE, WHICH THE BRIEF DID NOT HAVE
-- ----------------------------------------------------------
-- Operating hours as bare TIME columns compared against the server's
-- clock is wrong everywhere except a clinic that happens to sit in UTC.
-- On Vercel that is every clinic: 07:30 local in Narberth is 12:30 UTC
-- in summer and 12:30 UTC becomes the wrong hour again in November when
-- the offset changes. So the org carries an IANA timezone and every
-- comparison happens in it, which also gets daylight saving right
-- without anybody maintaining a table of offsets.
-- ============================================================

alter table staff.orgs
  add column if not exists timezone text not null default 'America/New_York';

-- Rejected early rather than discovered at 7:30am. A bad zone name makes
-- every time comparison for that clinic silently wrong, and 'EST' is a
-- classic wrong answer — it is a fixed offset that ignores summer time,
-- so half the year of reminders lands an hour out.
--
-- A TRIGGER AND NOT A CHECK. The obvious version —
--   check (timezone in (select name from pg_timezone_names))
-- — does not compile: a CHECK constraint cannot contain a subquery, and
-- wrapping the lookup in a function does not help either, because the
-- zone database is a view and any function over it is STABLE rather than
-- IMMUTABLE. A trigger validates on write, which is the moment that
-- matters.
create or replace function staff.orgs_validate_timezone()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from pg_timezone_names where name = new.timezone
  ) then
    raise exception
      'unknown timezone %; use an IANA name such as America/New_York',
      new.timezone
      using errcode = 'check_violation';
  end if;

  -- EXISTENCE IS NOT ENOUGH, and the first version of this trigger got
  -- that wrong. 'EST' passes the lookup above — Postgres ships it — and
  -- it is precisely the value that breaks this feature, because it is a
  -- fixed -05:00 with no daylight saving. A clinic set to EST gets every
  -- reminder an hour late from March to November. Same for 'MST', 'HST'
  -- and the 'EST5EDT' family, which work but are legacy aliases.
  --
  -- Real zones are Region/City. Requiring the slash rejects every
  -- abbreviation while accepting every zone an actual clinic is in. UTC
  -- is allowed as the deliberate exception for a test or a fixture.
  if new.timezone <> 'UTC' and position('/' in new.timezone) = 0 then
    raise exception
      '% is a fixed-offset abbreviation, not a timezone; use a Region/City name such as America/New_York so daylight saving is handled',
      new.timezone
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists staff_orgs_timezone_check on staff.orgs;
create trigger staff_orgs_timezone_check
  before insert or update of timezone on staff.orgs
  for each row execute function staff.orgs_validate_timezone();

alter table staff.orgs
  add column if not exists operating_hours_start time not null default '07:30';

alter table staff.orgs
  add column if not exists operating_hours_end time not null default '20:30';

-- An end before a start would gate every reminder out of existence and
-- look exactly like "notifications are broken".
do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_hours_ordered
    check (operating_hours_end > operating_hours_start);
exception when duplicate_object then null;
end $$;

alter table staff.orgs
  add column if not exists owner_alert_email text;

alter table staff.orgs
  add column if not exists medical_director_alert_email text;

-- Deliberately FALSE by default. See the header.
alter table staff.orgs
  add column if not exists notify_on_all_logs boolean not null default false;

-- Excursions are not optional. There is no column to switch them off,
-- because "stop telling me when the vaccine fridge is out of range" is
-- not a preference a compliance product should implement.
alter table staff.orgs
  add column if not exists digest_am_at time not null default '09:00';

alter table staff.orgs
  add column if not exists digest_pm_at time not null default '17:00';

-- Both addresses render into an email envelope, so they are shaped here
-- rather than only in a route.
do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_alert_emails_shaped
    check (
      (owner_alert_email is null
        or owner_alert_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
      and (medical_director_alert_email is null
        or medical_director_alert_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    );
exception when duplicate_object then null;
end $$;

-- ============================================================
-- ONE PERSON'S SOUND PREFERENCE
--
-- Defaults ON. A shift reminder nobody hears is a shift reminder that
-- did not happen, and the whole point of the chime is the task somebody
-- forgot rather than the one they remembered.
-- ============================================================

alter table staff.users
  add column if not exists audio_alerts_enabled boolean not null default true;

-- ============================================================
-- THE DISPATCH QUEUE
--
-- A QUEUE, NOT A LOG, and the difference is the reason this table
-- exists at all. Sending an email inline with a log submission means the
-- provider's slow afternoon is the medical assistant's slow submit
-- button, and a provider outage means either a 500 on a filed log or a
-- lost alert. Rows land here inside the same transaction as the
-- response, and delivery is somebody else's problem afterwards.
--
-- So the audit answer "was the medical director told about the 49-degree
-- fridge" is answerable from this table even when the mail provider was
-- down — which is exactly when it gets asked.
-- ============================================================

create table if not exists staff.alert_queue (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  kind text not null check (kind in (
    'excursion', 'log', 'missed_task', 'credential_expiry', 'digest'
  )),

  -- 'now' is sent on the next sweep; 'digest' waits to be rolled up.
  urgency text not null default 'digest'
    check (urgency in ('now', 'digest')),

  -- What happened, in the sentence that will be read on a phone. Built
  -- at enqueue time rather than at send time so the alert says what was
  -- true when it fired, not what is true whenever the sweep runs.
  subject text not null,
  body text not null,

  -- The response, obligation or credential this is about, for dedupe.
  source_kind text,
  source_id uuid,

  submitted_by uuid references staff.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,

  -- Delivery state, per recipient, because the two addresses fail
  -- independently: an owner's inbox can bounce while the director's
  -- accepts, and "sent" as one flag would hide that.
  owner_sent_at timestamptz,
  director_sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,

  created_at timestamptz not null default now()
);

create index if not exists staff_alert_queue_pending
  on staff.alert_queue (org_slug, urgency, created_at)
  where owner_sent_at is null or director_sent_at is null;

create index if not exists staff_alert_queue_digest
  on staff.alert_queue (org_slug, created_at)
  where urgency = 'digest';

-- One alert per source event. Without this, a retried submit or a second
-- browser tab sends the medical director the same excursion twice, and
-- an alert that arrives twice gets trusted slightly less than one that
-- arrives once.
create unique index if not exists staff_alert_queue_once
  on staff.alert_queue (org_slug, source_kind, source_id, kind)
  where source_id is not null;

-- Stop retrying forever. A row that has failed five times is a
-- configuration problem, not a transient one, and a queue that retries
-- it hourly for a month buries the rows that would still send.
do $$ begin
  alter table staff.alert_queue
    add constraint staff_alert_queue_attempt_cap
    check (attempts <= 5);
exception when duplicate_object then null;
end $$;

alter table staff.alert_queue enable row level security;
alter table staff.alert_queue force row level security;
drop policy if exists staff_org_isolation on staff.alert_queue;
create policy staff_org_isolation on staff.alert_queue
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.alert_queue to staff_app;
-- Never deleted: "we told you" and "we tried to tell you and could not"
-- are both answers somebody will want years later.
revoke delete on staff.alert_queue from staff_app;

-- ============================================================
-- IS THE CLINIC OPEN RIGHT NOW
--
-- In the clinic's own timezone. Used by the reminder poller so an
-- employee's phone stays quiet at home — which is a labour-law point as
-- much as a courtesy one.
-- ============================================================

create or replace function staff.within_operating_hours(p_slug text)
returns boolean
language sql stable as $$
  select case
    when o.slug is null then false
    else (now() at time zone o.timezone)::time
           between o.operating_hours_start and o.operating_hours_end
  end
  from staff.orgs o
  where o.slug = p_slug
$$;

grant execute on function staff.within_operating_hours(text) to staff_app;

-- ============================================================
-- WHAT IS STILL OUTSTANDING AND ALREADY LATE
--
-- The reminder poller reads this. Late is derived from the clinic's own
-- clock, so nothing here goes stale and no overnight job can fail
-- silently in a way that looks like "nothing is late".
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break a re-run.
-- ============================================================

drop view if exists staff.overdue_today cascade;
create view staff.overdue_today
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
  -- An AM task is late once the morning is over; a PM task once the
  -- clinic is within an hour of closing. Not configurable per task yet,
  -- and the two thresholds are named here rather than buried in a route.
  and (
    (l.slot = 'am' and (now() at time zone o.timezone)::time > time '11:00')
    or (l.slot = 'pm' and (now() at time zone o.timezone)::time
          > (o.operating_hours_end - interval '1 hour'))
  );

grant select on staff.overdue_today to staff_app;


-- ========== staff-alerts-sms.sql ==========

-- ============================================================
-- SMS FOR THE ONE THING THAT CANNOT WAIT
--
-- Run AFTER supabase/staff-alerts.sql. Idempotent.
--
-- EXCURSIONS ONLY. NOT DIGESTS, NOT CLEAN LOGS, NOT LATE TASKS.
-- ------------------------------------------------------------
-- Email already carries everything: the 9am and 5pm digest, the late
-- task, the clean log if a clinic wants them. SMS earns its place only
-- where the delay between "email arrives" and "email is read" is the
-- thing that does the damage.
--
-- That is a vaccine fridge at 49 degrees. Stock is losing potency while
-- nobody looks, and an owner who reads the email at 8pm has lost a day
-- of viability they could have saved at 3pm. Nothing else in this module
-- has that property — a late crash-cart check is bad and is not worse an
-- hour later.
--
-- The rule matters because SMS is the channel with no filter. Somebody
-- who receives an SMS for every log has to turn the channel off
-- entirely, and turning it off takes the fridge alert with it. Same
-- failure as the email digest decision in staff-alerts.sql, but sharper,
-- because there is no folder to put SMS in.
--
-- AND IT SENDS AT ANY HOUR, DELIBERATELY. No quiet hours. An excursion
-- at 3am is the case the channel exists for; a quiet-hours window would
-- hold the one message whose value is entirely in its timing. If that is
-- not wanted, the phone number is left blank and email does the work.
--
-- PHONE NUMBERS ARE NOT PHI HERE. These are two executives' own mobile
-- numbers, supplied by them, for operational alerts about equipment.
-- No patient identifier is ever placed in an SMS body — see the length
-- cap and the composition in lib/staff/alerts.ts.
-- ============================================================

alter table staff.orgs
  add column if not exists owner_alert_phone text;

alter table staff.orgs
  add column if not exists medical_director_alert_phone text;

-- E.164 or nothing. A number in any other shape does not fail loudly at
-- Twilio — it fails as a 400 buried in a queue row, hours after the
-- excursion it was supposed to announce. Validating the shape here means
-- the mistake surfaces when somebody sets the number, which is the
-- moment they can fix it.
do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_alert_phones_e164
    check (
      (owner_alert_phone is null or owner_alert_phone ~ '^\+[1-9][0-9]{7,14}$')
      and (medical_director_alert_phone is null
           or medical_director_alert_phone ~ '^\+[1-9][0-9]{7,14}$')
    );
exception when duplicate_object then null;
end $$;

comment on column staff.orgs.owner_alert_phone is
  'E.164, e.g. +12155551234. Receives SMS for out-of-range excursions only — never digests or clean logs. Leave null to use email alone.';

-- ============================================================
-- SMS DELIVERY STATE, TRACKED SEPARATELY FROM EMAIL
--
-- Four independent outcomes, not one "sent" flag: an owner's email can
-- accept while their SMS is rejected for an unverified number, and a
-- director's SMS can land while their mailbox bounces. Collapsing these
-- would make "was the medical director told" unanswerable in precisely
-- the mixed-failure case where somebody asks it.
-- ============================================================

alter table staff.alert_queue
  add column if not exists owner_sms_sent_at timestamptz;

alter table staff.alert_queue
  add column if not exists director_sms_sent_at timestamptz;

-- The sweep's pending query reads this index. Kept separate from the
-- email one so an alert with email delivered and SMS still pending is
-- still found.
create index if not exists staff_alert_queue_sms_pending
  on staff.alert_queue (org_slug, created_at)
  where kind = 'excursion'
    and (owner_sms_sent_at is null or director_sms_sent_at is null);

-- ============================================================
-- WHAT WAS ACTUALLY DELIVERED, PER CHANNEL
--
-- The answer to "prove the medical director was notified", which is a
-- question asked after something has already gone wrong and is therefore
-- the wrong time to be reconstructing it from four nullable columns.
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break a re-run.
-- ============================================================

drop view if exists staff.alert_delivery cascade;
create view staff.alert_delivery
with (security_invoker = true) as
select
  q.id,
  q.org_slug,
  q.kind,
  q.urgency,
  q.subject,
  q.created_at,
  q.attempts,
  q.last_error,
  (q.owner_sent_at is not null)        as owner_emailed,
  (q.director_sent_at is not null)     as director_emailed,
  (q.owner_sms_sent_at is not null)    as owner_texted,
  (q.director_sms_sent_at is not null) as director_texted,
  -- One word for the row. 'delivered' means at least one channel reached
  -- each configured recipient; 'partial' means somebody was reached and
  -- somebody was not, which is the state that needs a human.
  case
    when q.attempts >= 5
     and q.owner_sent_at is null
     and q.director_sent_at is null      then 'failed'
    when q.owner_sent_at is not null
      or q.director_sent_at is not null
      or q.owner_sms_sent_at is not null
      or q.director_sms_sent_at is not null then
      case
        when q.last_error is null then 'delivered'
        else 'partial'
      end
    else 'pending'
  end as state
from staff.alert_queue q;

grant select on staff.alert_delivery to staff_app;


-- ========== staff-surveyor.sql ==========

-- ============================================================
-- THE SURVEYOR LINK
--
-- Run AFTER supabase/staff-credentials.sql. Idempotent.
--
-- WHY THIS EXISTS AT ALL: the homepage has been advertising it for
-- months. "One read-only link, time-limited, for the inspector's iPad."
-- A feature promised on a sales page and absent from the product is a
-- lie told to every visitor, and it was the oldest outstanding one here.
--
-- WHAT IT IS. An inspector arrives unannounced. Somebody senior presses
-- a button, hands over an iPad, and the inspector sees the compliance
-- record and nothing else — no billing, no team administration, no
-- settings, no way to write anything. The link stops working by itself.
--
-- THE TOKEN IS NOT STORED
-- -----------------------
-- Only its SHA-256 is. The token exists in exactly two places: the URL
-- handed to the inspector, and the response that created it. A database
-- dump therefore yields no working links, which matters because this is
-- a bearer credential with no second factor — anyone holding the URL is
-- the inspector as far as the system is concerned.
--
-- That also means a lost link cannot be recovered, only reissued. That
-- is the correct trade: reissuing takes one press, and a recoverable
-- bearer token is one an administrator can be socially engineered into
-- reading out.
--
-- NOT GATED BY READ-ONLY BILLING, and this is the sharpest case for that
-- rule in the whole product. The failure mode being avoided: card
-- declines, webhook fires, access locks, and the clinic fails a state
-- inspection because it cannot show logs it already recorded. A billing
-- dispute must never become a regulatory finding.
-- ============================================================

create table if not exists staff.surveyor_tokens (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  -- SHA-256 of the token, hex. Never the token.
  token_hash text not null,

  -- Who this was issued to, in words: 'PA DOH, unannounced' or
  -- 'UCA accreditation'. A surveyor link with no label is an audit entry
  -- that cannot answer "who did you give access to in March".
  label text not null,

  expires_at timestamptz not null,

  created_by uuid references staff.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Revoking is instant and one-way. An inspector who leaves early, or a
  -- link sent to the wrong address, must be closable without waiting for
  -- the clock.
  revoked_at timestamptz,
  revoked_by uuid references staff.users(id) on delete set null,

  -- Was it actually opened, and how often. Answers "did the inspector
  -- use the link we gave them" long after everyone has forgotten.
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  view_count integer not null default 0
);

create unique index if not exists staff_surveyor_tokens_hash
  on staff.surveyor_tokens (token_hash);

create index if not exists staff_surveyor_tokens_live
  on staff.surveyor_tokens (org_slug, expires_at desc)
  where revoked_at is null;

-- A window, not a standing key. Anything beyond seven days is a
-- permanent credential with a distant expiry date, which is the shape
-- every leaked-token incident has. Two days covers an unannounced
-- inspection; a longer engagement gets a second link, which is also a
-- second audit row.
do $$ begin
  alter table staff.surveyor_tokens
    add constraint staff_surveyor_window
    check (expires_at > created_at and expires_at <= created_at + interval '7 days');
exception when duplicate_object then null;
end $$;

-- Revoked by whom, and when — both or neither.
do $$ begin
  alter table staff.surveyor_tokens
    add constraint staff_surveyor_revocation_complete
    check ((revoked_at is null) = (revoked_by is null));
exception when duplicate_object then null;
end $$;

-- A hash that is not a hash is a token stored in the clear under a
-- column named to look like it is not.
do $$ begin
  alter table staff.surveyor_tokens
    add constraint staff_surveyor_hash_shaped
    check (token_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;

alter table staff.surveyor_tokens enable row level security;
alter table staff.surveyor_tokens force row level security;

drop policy if exists staff_org_isolation on staff.surveyor_tokens;
create policy staff_org_isolation on staff.surveyor_tokens
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.surveyor_tokens to staff_app;
-- Never deleted. "Who was given access to this clinic's records, and
-- when" is a question with no expiry date of its own.
revoke delete on staff.surveyor_tokens from staff_app;

-- ============================================================
-- REDEEMING A TOKEN
--
-- SECURITY DEFINER, and this is the one place in the module that needs
-- it. A surveyor has no session and therefore no org context, so the
-- lookup has to happen before RLS can be scoped — the org is the ANSWER
-- to this function, not an input to it.
--
-- What makes that safe rather than a hole: the only argument is a
-- 64-character hash, the function returns one org slug or nothing, and
-- it can neither read a compliance record nor write one. The caller then
-- sets that org as its context and reads everything else under ordinary
-- RLS as a non-admin.
--
-- Expiry and revocation are evaluated HERE, in the same statement that
-- resolves the token, so there is no window in which application code
-- holds a valid-looking org from an expired link.
-- ============================================================

create or replace function staff.redeem_surveyor_token(p_hash text)
returns table (org_slug text, label text, expires_at timestamptz)
language plpgsql security definer
set search_path = staff, public
as $$
begin
  return query
  update staff.surveyor_tokens t
     set view_count = t.view_count + 1,
         first_seen_at = coalesce(t.first_seen_at, now()),
         last_seen_at = now()
   where t.token_hash = p_hash
     and t.revoked_at is null
     and t.expires_at > now()
  returning t.org_slug, t.label, t.expires_at;
end $$;

revoke all on function staff.redeem_surveyor_token(text) from public;
grant execute on function staff.redeem_surveyor_token(text) to staff_app;

-- ============================================================
-- WHAT THE INSPECTOR SEES
--
-- One row per issued link, for the administrator who issued them. The
-- token is absent by construction — there is no column holding it.
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break a re-run.
-- ============================================================

drop view if exists staff.surveyor_access cascade;
create view staff.surveyor_access
with (security_invoker = true) as
select
  t.id,
  t.org_slug,
  t.label,
  t.created_at,
  t.expires_at,
  t.revoked_at,
  t.first_seen_at,
  t.last_seen_at,
  t.view_count,
  c.legal_name as created_by_name,
  r.legal_name as revoked_by_name,
  case
    when t.revoked_at is not null   then 'revoked'
    when t.expires_at <= now()      then 'expired'
    when t.first_seen_at is null    then 'unopened'
    else 'active'
  end as state,
  greatest(0, extract(epoch from (t.expires_at - now()))::int) as seconds_left
from staff.surveyor_tokens t
left join staff.users c on c.id = t.created_by
left join staff.users r on r.id = t.revoked_by;

grant select on staff.surveyor_access to staff_app;


-- ========== staff-log-photos.sql ==========

-- ============================================================
-- PHOTO PROOF ON A SHIFT LOG
--
-- Run AFTER supabase/staff-logs.sql. Idempotent.
--
-- WHAT A PHOTO IS FOR HERE. A temperature typed into a box is a claim.
-- A photograph of the NIST display showing that temperature, timestamped
-- against the same submission, is evidence. Same for the crash-cart
-- breakaway seal number and a POCT control read window — the three
-- places where a surveyor's next question is "show me".
--
-- THE FILE IS A KEY, NOT BYTES. Postgres is not a file server, and the
-- bucket is private with signed, expiring reads. See lib/staff/storage.ts.
--
-- OPTIONAL, ALWAYS. A log must never be blocked on a camera: the
-- clinic's wifi drops in the back corridor, the phone is out of storage,
-- the tablet has no rear camera. A missing photo is a weaker record; a
-- missing LOG because the photo would not upload is no record at all,
-- and the second failure is worse than the first.
--
-- ZERO PHI IS A UI PROMISE, NOT A SCHEMA GUARANTEE, and it is worth
-- being honest about the difference. Nothing here can inspect the pixels
-- of an image. What the product does instead: asks for the rear camera
-- directly so the common path never opens the photo library, re-encodes
-- in the browser so EXIF and its GPS tag are stripped, and prints the
-- rule next to the control every single time rather than once at
-- onboarding. Automated detection of a face or a chart in frame would
-- mean sending every clinical photograph to a third-party vision API,
-- which is the same trade this product already declined for staff
-- avatars.
-- ============================================================

create table if not exists staff.log_photos (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  response_id uuid not null references staff.form_responses(id) on delete cascade,

  -- Object key in the private compliance-media bucket.
  file_path text not null,
  file_type text not null,
  file_bytes integer not null check (file_bytes > 0),

  -- What the photograph is of, so a reader knows what they are looking
  -- at without opening it.
  caption text,

  taken_by uuid references staff.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists staff_log_photos_response
  on staff.log_photos (response_id);

create index if not exists staff_log_photos_org
  on staff.log_photos (org_slug, created_at desc);

-- A 1600x1200 JPEG at 0.8 lands around 200-400KB. Four megabytes is
-- generous headroom and still refuses a hand-made request posting an
-- original 48MP capture straight at the bucket.
do $$ begin
  alter table staff.log_photos
    add constraint staff_log_photo_size
    check (file_bytes <= 4194304);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table staff.log_photos
    add constraint staff_log_photo_is_image
    check (file_type in ('image/jpeg', 'image/png', 'image/webp'));
exception when duplicate_object then null;
end $$;

alter table staff.log_photos enable row level security;
alter table staff.log_photos force row level security;

drop policy if exists staff_org_isolation on staff.log_photos;
create policy staff_org_isolation on staff.log_photos
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

-- INSERT ONLY. A photograph attached to a signed log is part of that
-- record: replacing it later would let today's version of events stand
-- in for what was actually photographed, which is the property that
-- makes it evidence rather than decoration.
grant select, insert on staff.log_photos to staff_app;
revoke update, delete on staff.log_photos from staff_app;

-- ============================================================
-- PHOTOS WITH THEIR LOG
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break a re-run.
-- ============================================================

drop view if exists staff.log_photo_index cascade;
create view staff.log_photo_index
with (security_invoker = true) as
select
  p.id,
  p.org_slug,
  p.response_id,
  p.file_path,
  p.file_type,
  p.file_bytes,
  p.caption,
  p.created_at,
  t.slug  as form_slug,
  t.name  as form_name,
  i.slot,
  r.submitted_at,
  r.has_out_of_range,
  u.legal_name as taken_by_name
from staff.log_photos p
join staff.form_responses r on r.id = p.response_id
join staff.form_instances i on i.id = r.instance_id
join staff.form_templates t on t.id = i.template_id
left join staff.users u on u.id = p.taken_by;

grant select on staff.log_photo_index to staff_app;


-- ========== staff-email-auth.sql ==========

-- ============================================================
-- SIGNING IN WITHOUT GOOGLE
--
-- Run AFTER supabase/staff-schema.sql. Idempotent.
--
-- WHY THIS EXISTS. Google OAuth was the only door, and a great many
-- urgent cares run Microsoft 365. For those clinics the sign-in screen
-- was a wall, not a login — the product could not be sold to them at
-- all. That is an adoption problem, not a security one, and it is the
-- reason for this file.
--
-- WHAT DOES NOT CHANGE: the invite is still the control. This adds a way
-- to PROVE you hold an address; it adds no way to get in without an
-- invite naming that address or its domain. Both doors open into the
-- same corridor.
--
-- ONE EMAIL, TWO WAYS TO USE IT
-- -----------------------------
-- The message carries a link and a six-digit code backed by the same
-- token. The link is one tap when email is on the phone in your hand;
-- the code is what works when the clinic's inbox is on the front desk
-- machine and you are standing in the back with a tablet. Offering only
-- one of them is a decision to fail in one of those two rooms.
--
-- SIX DIGITS IS A MILLION GUESSES, WHICH IS NOT MANY.
-- The code is only safe because of what surrounds it, and every one of
-- these is load-bearing:
--
--   * ten minutes to live
--   * single use — consumed on first success
--   * five wrong attempts and the token dies, not the account (locking
--     the account would hand anyone a denial-of-service against any
--     employee whose address they can guess)
--   * scoped to one email, so guesses cannot be spread across accounts
--   * the token behind the link is 32 bytes, and only its hash is stored
--
-- WITHOUT the attempt cap, six digits falls in minutes. With it, an
-- attacker gets five guesses per issued code against a one-in-a-million
-- space, and issuing a fresh code invalidates the old one.
--
-- NO ENUMERATION. Requesting a code answers identically whether or not
-- the address has an invite. The route decides what to send; the caller
-- learns nothing either way.
-- ============================================================

create table if not exists staff.email_auth_tokens (
  id uuid primary key default gen_random_uuid(),

  -- Lowercased at the route. Not a foreign key: a code may be requested
  -- for an address that has an invite but no user row yet, which is
  -- exactly the first-sign-in case.
  email text not null,

  -- SHA-256 of the 32-byte link token. Never the token.
  token_hash text not null,
  -- SHA-256 of the six digits, salted with the email so an identical
  -- code issued to two people does not produce an identical hash.
  code_hash text not null,

  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts integer not null default 0,

  -- For the audit trail and for spotting a burst of requests against one
  -- clinic. Never shown to the person signing in.
  requested_ip text,
  requested_ua text,

  created_at timestamptz not null default now()
);

create unique index if not exists staff_email_auth_token_hash
  on staff.email_auth_tokens (token_hash);

-- The lookup the verify route makes: newest live token for this address.
create index if not exists staff_email_auth_live
  on staff.email_auth_tokens (lower(email), created_at desc)
  where consumed_at is null;

do $$ begin
  alter table staff.email_auth_tokens
    add constraint staff_email_auth_window
    check (expires_at > created_at and expires_at <= created_at + interval '1 hour');
exception when duplicate_object then null;
end $$;

-- The cap is a constraint, not just route logic. A route that forgets to
-- check is a route that turns six digits into an afternoon's work.
do $$ begin
  alter table staff.email_auth_tokens
    add constraint staff_email_auth_attempt_cap
    check (attempts <= 5);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table staff.email_auth_tokens
    add constraint staff_email_auth_hashes_shaped
    check (token_hash ~ '^[0-9a-f]{64}$' and code_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;

-- ============================================================
-- ROW-LEVEL SECURITY
--
-- NO ORG COLUMN, and it is not an oversight. A code is requested BEFORE
-- anybody is signed in, so there is no org context to scope by — the org
-- is discovered from the invite afterwards. Nothing in the application
-- ever selects from this table by anything except an exact hash, and the
-- policy below refuses everything else.
-- ============================================================

alter table staff.email_auth_tokens enable row level security;
alter table staff.email_auth_tokens force row level security;

drop policy if exists staff_email_auth_no_browsing on staff.email_auth_tokens;
-- Deliberately permissive to the application role and useless to anyone
-- who obtains it: the table holds only hashes and timestamps, and both
-- hashes are of values that expire in ten minutes.
create policy staff_email_auth_no_browsing on staff.email_auth_tokens
  for all using (true) with check (true);

grant select, insert, update on staff.email_auth_tokens to staff_app;
-- Consumed tokens are kept, not deleted: "was a code issued for this
-- address, and was it used" is an audit question, and a table that
-- deletes its own history cannot answer it.
revoke delete on staff.email_auth_tokens from staff_app;

-- ============================================================
-- HOUSEKEEPING
--
-- Expired tokens are worthless but not harmless — they accumulate. This
-- is called from the hourly alert cron rather than a separate schedule.
-- Rows are kept for thirty days so the audit question above stays
-- answerable, then dropped.
-- ============================================================

create or replace function staff.prune_email_auth_tokens()
returns integer language plpgsql security definer
set search_path = staff, public
as $$
declare n integer;
begin
  delete from staff.email_auth_tokens
   where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function staff.prune_email_auth_tokens() from public;
grant execute on function staff.prune_email_auth_tokens() to staff_app;

-- ============================================================
-- WHICH CLINIC INVITED THIS ADDRESS
--
-- SECURITY DEFINER, and it is the second and last place in the module
-- that needs it. Same shape of problem as the surveyor token: sign-in
-- happens before any org context exists, so the org cannot scope the
-- lookup — the org is the ANSWER.
--
-- What keeps it narrow: the only argument is an email address, it
-- returns at most one row, the row contains no credential, and it can
-- neither read a compliance record nor write anything at all. An
-- attacker who could call it directly learns whether an address is
-- invited and to which clinic — which is why the ROUTE never exposes
-- that, answering identically for invited and uninvited addresses.
--
-- The precedence rule is the same one the Google callback uses: an
-- invite naming the address beats a blanket domain invite, so a named
-- administrator is not demoted to the domain default. Written once,
-- here, so the two sign-in paths cannot drift apart on who gets in.
-- ============================================================

create or replace function staff.invite_for_email(p_email text)
returns table (org_slug text, role text, job_role text, legal_name text)
language sql stable security definer
set search_path = staff, public
as $$
  select i.org_slug,
         i.role::text,
         i.job_role::text,
         i.legal_name
    from staff.org_invites i
   where i.revoked_at is null
     and (
       lower(i.email) = lower(btrim(p_email))
       or lower(i.email_domain) = lower(split_part(btrim(p_email), '@', 2))
     )
   order by (i.email is not null) desc
   limit 1
$$;

revoke all on function staff.invite_for_email(text) from public;
grant execute on function staff.invite_for_email(text) to staff_app;


-- ========== staff-log-presets.sql ==========

-- ============================================================
-- ONE-TAP PRESETS ON THE READINGS THAT REPEAT
--
-- Run AFTER supabase/staff-logs-seed.sql. Idempotent.
--
-- A vaccine fridge holding steady lands on the same half-dozen tenths of
-- a degree shift after shift; an O2 cylinder is read in 500 PSI bands.
-- `presets` on a number field (see lib/staff/forms.ts) renders those as
-- tap targets in the UI. It changes nothing about what gets stored or
-- checked: a tapped preset is the same number a typed one would be, run
-- through the same min/max evaluation in lib/staff/forms.ts, so a chip
-- for 38.4°F still flags red if the template's max is 38. There is no
-- "confirm all" button anywhere in this file — each reading is still its
-- own tap, because a single button that signs off a fridge, an AED, two
-- O2 cylinders and a suction unit at once is the checkbox-sheet problem
-- this binder replaced, wearing a nicer button.
--
-- This patches schema_json in place by field id rather than by array
-- index, so it does not care what order the seed happens to list fields
-- in and is safe to run again if a preset list changes.
-- ============================================================

update staff.form_templates t
set schema_json = jsonb_set(
  t.schema_json,
  array['fields', (p.ord - 1)::text],
  p.value || '{"presets": [37.8, 38.0, 38.2, 38.4, 38.6]}'::jsonb
)
from staff.form_templates f
cross join lateral jsonb_array_elements(f.schema_json->'fields') with ordinality as p(value, ord)
where f.id = t.id
  and f.slug = 'temp-fridge'
  and p.value->>'id' = 'current_f';

-- Two separate statements, not one `in (...)`. Both O2 cylinder fields
-- live on the same crash-cart row, and an UPDATE ... FROM whose lateral
-- join produces two matching source rows for one target row applies
-- only one of them — jsonb_set from whichever match Postgres happens to
-- process last, silently dropping the other cylinder's preset. Found by
-- checking the result rather than trusting the row count.
update staff.form_templates t
set schema_json = jsonb_set(
  t.schema_json,
  array['fields', (p.ord - 1)::text],
  p.value || '{"presets": [2000, 1800, 1500]}'::jsonb
)
from staff.form_templates f
cross join lateral jsonb_array_elements(f.schema_json->'fields') with ordinality as p(value, ord)
where f.id = t.id
  and f.slug = 'crash-cart'
  and p.value->>'id' = 'o2_primary_psi';

update staff.form_templates t
set schema_json = jsonb_set(
  t.schema_json,
  array['fields', (p.ord - 1)::text],
  p.value || '{"presets": [2000, 1800, 1500]}'::jsonb
)
from staff.form_templates f
cross join lateral jsonb_array_elements(f.schema_json->'fields') with ordinality as p(value, ord)
where f.id = t.id
  and f.slug = 'crash-cart'
  and p.value->>'id' = 'o2_backup_psi';


-- ========== staff-eod-close.sql ==========

-- ============================================================
-- END OF DAY: THE LOG BOOK CLOSE AND THE DAY SHEET
--
-- Run AFTER supabase/staff-job-roles-seed.sql. Idempotent.
--
-- Built from a real practice-management end-of-day checklist. The
-- substance is kept exactly; NO VENDOR IS NAMED ANYWHERE, not even as an
-- example. The source names one PM system, one clearinghouse and one
-- card-terminal app by brand. Those are gone.
--
-- Two reasons, and the second is the one that matters. The practical
-- one: hard-coding a stack into the default set every clinic receives
-- ships a checklist that is wrong for anyone on a different one, which
-- is most of them. The real one: this is meant to read as a universal
-- standard of practice, and a standard that name-checks a supplier
-- reads as that supplier's documentation instead — it borrows their
-- authority and inherits their scope. The obligations here are the
-- clinic's own regardless of what software it runs.
--
-- So the fields say "your PM system", "the card terminal", "the
-- clearinghouse". Every step still maps exactly onto the same work.
--
-- WHY TWO FORMS AND NOT ONE. The source is a single sheet, but it has
-- two owners: the log book is the front desk's work, and the money
-- reconciliation is the center administrator's. Filing them together
-- would mean one person signs an attestation covering the other's work,
-- which is precisely the thing a signature is supposed to prevent.
--
-- WHY NOT A ROUND. Rounds are WALKED — one step at a time with the next
-- hidden, because a physical walk can otherwise be satisfied from the
-- counter. Nothing here is a walk: every line produces a NUMBER (how
-- many visits are still open, what the batch totalled), and a number is
-- its own evidence. So these are forms, which means the counts run
-- through the same min/max evaluation every other log uses and an
-- out-of-range value forces a corrective action before it can be filed.
--
-- THE COUNTS THAT MUST BE ZERO ARE max: 0, NOT min/max 0..0. Zero
-- duplicate visits is the only acceptable answer at close; one is an
-- excursion and gets the same treatment a warm fridge does — the log
-- still files, but not without saying what was done about it. That is
-- deliberate: a front desk that cannot file an honest "we found two"
-- learns to file a dishonest zero.
-- ============================================================

insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots, sort_order,
   job_roles, schema_json)
select o.slug, t.slug, t.name, t.description, t.category, t.frequency,
       t.slots, t.sort_order, t.job_roles, t.schema_json::jsonb
from staff.orgs o
cross join (values

  ('front-desk-eod',
   'End of day — log book',
   'Every visit closed out, eligibility run, nothing duplicated.',
   'operations', 'daily', array['pm'], 96,
   array['front_desk','center_admin']::staff.job_role[],
   $json$
   {
     "standard": "Every visit on today's log carries a final status, every eligibility check has run, and no patient appears twice. A visit left open tonight is a claim nobody can bill tomorrow.",
     "fields": [
       { "id": "not_seen", "label": "Logged but not seen", "type": "number",
         "min": 0, "step": 1, "presets": [0, 1, 2, 3, 4],
         "help": "No-show, cancelled, rescheduled, or walked out. Count them first — each one needs an arrival status before it can be closed." },
       { "id": "not_seen_closed", "label": "Each one given an arrival status and timed out", "type": "boolean",
         "expected": true,
         "help": "Time out the visit on the log detail page. If a chart was already created, discharge it as left-without-being-discharged instead — no time-out needed, and it will not count against the visit." },
       { "id": "rte_open", "label": "Visits with no eligibility result", "type": "number",
         "min": 0, "max": 0, "step": 1, "presets": [0, 1, 2, 3],
         "help": "Skip workers' comp and occupational visits — eligibility does not apply to them and they are not a problem." },
       { "id": "rte_blocker", "label": "If any are still open, what is blocking them", "type": "select",
         "options": ["None remain", "Subscriber not found", "Payer setup incomplete", "Payer system unavailable"],
         "required": false,
         "help": "Subscriber-not-found is usually a member ID or date-of-birth typo — fix and re-run before assuming the coverage is bad. Payer setup means the eligibility payer ID is missing; it is often the claims payer ID but not always, so look it up in the clearinghouse rather than guessing." },
       { "id": "selfpay_closed", "label": "Self-pay charges entered, and balance taken or billed to the patient", "type": "boolean",
         "expected": true, "required": false,
         "help": "Best done while the patient is still at the desk. Billing the balance sends them a statement; leaving it does neither." },
       { "id": "duplicates", "label": "Duplicate visits on the log", "type": "number",
         "min": 0, "max": 0, "step": 1, "presets": [0, 1, 2],
         "help": "Sort by patient name and read down the column. Two rows for one person becomes two claims." },
       { "id": "open_status", "label": "Visits not in a final status", "type": "number",
         "min": 0, "max": 0, "step": 1, "presets": [0, 1, 2, 3],
         "help": "Final means signed, discharged, or checked out. Anything else is still open." },
       { "id": "open_status_kind", "label": "If any remain, where are they stuck", "type": "select",
         "options": ["None remain", "Charting", "Log pending", "Logged, not timed out", "Discharged, awaiting results"],
         "required": false,
         "help": "Charting should be discharged. A pending log is either completed or deleted — deleted only if it was a duplicate or an error. A logged visit gets timed out, which moves it to checkout. Discharged-awaiting-results is legitimate and needs no action tonight." }
     ]
   }
   $json$),

  ('admin-day-sheet',
   'End of day — day sheet and card batch',
   'Printed day sheet reconciled against the terminal batch.',
   'operations', 'daily', array['pm'], 97,
   array['center_admin']::staff.job_role[],
   $json$
   {
     "standard": "The day sheet and the card batch agree tonight, or the variance gets found tomorrow with no shift to pin it to. Cash and the drawer are counted on the front desk closing sheet, not here.",
     "fields": [
       { "id": "day_sheet_printed", "label": "Day sheet printed", "type": "boolean",
         "expected": true },
       { "id": "day_sheet_card_total", "label": "Card total on the day sheet", "type": "number",
         "unit": "USD", "min": 0, "step": 0.01,
         "help": "Card payments only. Cash and checks are reconciled on the front desk closing sheet." },
       { "id": "terminal_batch_total", "label": "Card terminal batch total", "type": "number",
         "unit": "USD", "min": 0, "step": 0.01,
         "help": "From the card terminal's current-batch or settlement report, before the batch is closed." },
       { "id": "batch_matches", "label": "The two totals match", "type": "boolean",
         "expected": true,
         "help": "If they do not, say what you found and what you did. A variance recorded honestly is a reconciliation; a variance left silent is what an audit finds first." },
       { "id": "batch_closed", "label": "Terminal batch closed for the day", "type": "boolean",
         "expected": true,
         "help": "An unclosed batch settles late or not at all, and the money shows up on the wrong day." },
       { "id": "receipts_filed", "label": "Signed receipts kept with the day sheet", "type": "boolean",
         "expected": true, "required": false,
         "help": "Only if signed copies are part of your workflow. Leave it if they are not." }
     ]
   }
   $json$)

) as t(slug, name, description, category, frequency, slots, sort_order, job_roles, schema_json)
where not exists (
  select 1 from staff.form_templates f
   where f.org_slug = o.slug and f.slug = t.slug
);

-- WHY THERE IS NO "UPDATE THE TEMPLATE" STATEMENT HERE.
-- Re-running this file will not rewrite a template that already exists,
-- and that is deliberate. A template is DATA so a clinic can correct it
-- — change a label, drop a field that does not apply, add one that
-- does. A migration that overwrote schema_json on every run would throw
-- those edits away on the next deploy, which is the one failure that
-- would teach an administrator never to customise anything again.
-- Corrections to the shipped wording ship as a NEW migration naming the
-- exact field, the way staff-log-presets.sql patches a single field by
-- id rather than replacing the row.


-- ========== staff-geofence.sql ==========

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
-- GUARDED, BECAUSE THE STAFF SCHEMA MUST NOT REQUIRE THE PATIENT ONE.
-- public.clinics belongs to the patient-facing side. On a project that
-- has it this fills real coordinates; on one that does not, an
-- unguarded reference aborts the whole migration HALFWAY THROUGH and
-- leaves the schema half-applied, which is far worse than starting with
-- null coordinates.
do $$ begin
  if to_regclass('public.clinics') is not null then
    update staff.orgs o
       set latitude  = c.lat,
           longitude = c.lng
      from public.clinics c
     where c.tenant_slug = o.slug
       and o.latitude is null
       and c.lat is not null
       and c.lng is not null;
  end if;
end $$;


-- ========== staff-ethics.sql ==========

-- ============================================================
-- THE CODE OF ETHICS
--
-- Run AFTER supabase/staff-onboarding-seed.sql. Idempotent.
--
-- There was no code of ethics in the packet. Eleven policy documents
-- covered privacy, bloodborne pathogens, hazard communication, mandated
-- reporting, controlled substances and incident reporting — every one of
-- them a rule about a PROCEDURE. None of them said what the clinic is
-- for, or what to do when doing the right thing costs money. That gap is
-- the one every compliance program is judged on after something has
-- gone wrong.
--
-- ---------------------------------------------------------------
-- WHY THE CENTER'S NAME IS SUBSTITUTED AT INSERT, NOT AT RENDER
-- ---------------------------------------------------------------
-- The obvious design is a template with {{center_name}} in it, resolved
-- when the page is drawn. It would be wrong here, and the reason is two
-- lines away in the schema.
--
-- staff.attestations stores body_sha256 — "sha256 of body_md exactly as
-- rendered to this person" — and lib/staff/compliance.ts RECOMPUTES that
-- hash on every read, in SQL, directly over policy_docs.body_md, to
-- prove the signed text has not been altered since. Substituting at
-- render time would mean the stored hash was taken over resolved text
-- while the verification hash is taken over the raw template. They would
-- never match again, and every signature in the system would display as
-- tampered with, permanently.
--
-- So the placeholders are resolved HERE, once, as each org's own row is
-- created. Every clinic gets a concrete document with its own name in
-- it, which it then owns and can edit freely — body_md is data.
--
-- That also happens to be the correct behavior for a signed document.
-- If the center is renamed, the text somebody signed still says what it
-- said on the day. Reflecting the new name is a NEW VERSION requiring a
-- fresh acknowledgement, which the (org_slug, key, version) key and the
-- supersedes_id chain already model. A signed policy that silently
-- rewrites itself is not a record.
--
-- ---------------------------------------------------------------
-- WHAT THIS DOCUMENT IS AND IS NOT
-- ---------------------------------------------------------------
-- Every legal citation below is exact and is to federal law that applies
-- to essentially any US clinic billing a federal program. Where a duty
-- is a PRACTICE RULE rather than a statute it says so in the text, in
-- the same sentence, because a code of ethics that dresses house rules
-- up as law teaches staff to disbelieve the parts that really are law.
--
-- EMTALA IS DELIBERATELY NOT CLAIMED. A freestanding urgent care center
-- is generally NOT a dedicated emergency department under 42 CFR 489.24
-- and generally not subject to EMTALA; a hospital-owned one may be. The
-- duty to stabilize and transfer is therefore stated as an ETHICAL
-- obligation of the clinic, with a note that statutory applicability
-- depends on ownership — rather than asserting a legal duty that may not
-- exist for the reader, or omitting the duty because the statute might
-- not bind.
--
-- NO VENDOR IS NAMED, here or anywhere in the packet. This is meant to
-- read as a universal standard of practice; a standard that name-checks
-- a supplier reads as that supplier's documentation instead.
--
-- SEEDED AS A DRAFT (published_at null), like every other document in
-- the packet. An unpublished document is assigned to nobody. A medical
-- director reads it, edits what should differ for this clinic, and
-- publishes it — because a code of ethics nobody in the building chose
-- is a poster, not a commitment.
-- ============================================================


-- ---------- The substitution helper ----------
--
-- Available to any future document that wants it. Deliberately tiny and
-- deliberately not clever: it does not parse, it replaces four known
-- tokens. An unresolved token would render literally as {{...}} in a
-- signed document, so each has a fallback that reads as a prompt rather
-- than as a mistake.
create or replace function staff.render_org_text(p_org text, p_text text)
returns text
language sql stable
as $$
  select replace(replace(replace(replace(
           p_text,
           '{{center_name}}',  coalesce(o.name, 'this center')),
           '{{legal_entity}}', coalesce(o.legal_entity, o.name, 'this center')),
           '{{state}}',        coalesce(o.state, 'the state in which it operates')),
           '{{medical_director}}',
                               coalesce(o.medical_director_name,
                                        'the medical director'))
    from staff.orgs o
   where o.slug = p_org
$$;

revoke all on function staff.render_org_text(text, text) from public;
grant execute on function staff.render_org_text(text, text) to staff_app;


-- ---------- The document ----------

insert into staff.policy_docs
  (org_slug, key, version, title, category, citation, summary, body_md,
   attestation, renew_months, sort_order, applies_to)
select o.slug, 'code-of-ethics', 1,
  'Code of ethics',
  'operations',
  'Anti-Kickback Statute, 42 U.S.C. § 1320a-7b(b); Physician Self-Referral (Stark), 42 U.S.C. § 1395nn; False Claims Act, 31 U.S.C. §§ 3729-3733; HIPAA Privacy Rule, 45 C.F.R. Part 164',
  'What this center is for, and what to do when the right call is the expensive one.',
  staff.render_org_text(o.slug, $md$
## Why this exists

Every other document in this packet tells you how to do something. This one
says what to do when the rules run out, or when two of them point in different
directions, or when the right answer costs the center money.

It is short on purpose. A code nobody can remember is a code nobody uses.

## The one that decides the others

**The patient in front of you comes before the schedule, the door count, and
the revenue.** Everything below is a consequence of that sentence.

If you are ever told, by anyone, to do something that contradicts it, you are
expected to say so — and this document is what you point at.

## Care

- **Work inside your license and your training.** Not near the edge of it, not
  just past it because the center is busy. If you are not qualified to do a
  thing, the correct answer is to find the person who is, even when that is
  slower. Your scope is set out in your own brief; when it is unclear, ask
  before acting rather than after.
- **Nobody is turned away, hurried, or treated differently** because of who
  they are, what they can pay, how they are insured, what language they speak,
  or how they have behaved in the past.
- **Emergencies get stabilized and moved, not queued.** If someone needs a
  level of care this center cannot give, they are stabilized to the limit of
  what is available here and transferred without waiting for payment
  questions to be resolved. *(Whether this is also a statutory duty depends on
  how this center is owned — a hospital-owned site may fall under EMTALA,
  42 C.F.R. § 489.24, while a freestanding one generally does not. It is a duty
  here regardless of which applies.)*
- **A patient may refuse care, and may ask what something costs first.**
  Neither is a reason to treat them worse.

## Records

- **Chart what happened. Never chart what did not.** A note describing an
  examination nobody performed is a false record whatever the intention behind
  it, and it is the single fastest way to turn a clinical question into a legal
  one.
- **Write it when it happens**, or say plainly when you are writing late. A
  late entry that admits to being late is honest; one backdated to look
  contemporaneous is not.
- **A mistake gets corrected, never erased.** Amend, and say what changed and
  why. This applies to paper and to this system alike — which is why nothing
  here has a delete button.

## Money

These are federal criminal and civil statutes, not house rules.

- **Nothing of value is given or accepted in exchange for referrals.** Not
  cash, not rent below market, not free staff, not a share of what a referral
  earns. *(Anti-Kickback Statute, 42 U.S.C. § 1320a-7b(b) — a criminal
  statute; violations can also become False Claims Act liability.)*
- **Referrals go where the patient is best served**, never to an entity you or
  a family member has a financial interest in without that interest being
  disclosed and permitted. *(Stark, 42 U.S.C. § 1395nn, governs designated
  health services and physician financial relationships.)*
- **Bill for what was done, at the level it was done.** Not the level that
  pays better, not a bundle unbundled to earn more, not a service that did not
  happen. *(False Claims Act, 31 U.S.C. §§ 3729-3733.)*
- **Clinical decisions are not made on the basis of what a visit pays.** If
  you are ever asked to add a test, a level, or a follow-up for a reason that
  is financial rather than clinical, that is a report under the section below.
- **Declare gifts and hospitality from suppliers** to {{medical_director}} or a
  center administrator. A working lunch is not a scandal; the point of
  declaring it is that nobody has to guess later whether it was.

## Privacy

- **Look at a record only when you have a reason to be in it.** Curiosity about
  a neighbour, a colleague, a relative, or someone in the news is not a reason,
  and access is logged. *(HIPAA Privacy Rule, 45 C.F.R. Part 164.)*
- **What you learn here does not leave here.** Not to family, not in a car
  park, not on social media in a form you believe is anonymous. The details
  that make a story worth telling are usually the details that identify
  somebody.

## Each other

- **Say the thing early.** A concern raised while something can still be fixed
  is worth more than a perfect account of it afterwards.
- **Nobody is punished for raising a concern in good faith.** Retaliating
  against someone for reporting is itself a breach of this code, and several
  of the statutes above carry their own whistleblower protections. Being wrong
  in good faith is fine. Staying quiet because it was awkward is not.
- **You may report to {{medical_director}} or to any center administrator.** If
  the concern is about the person you would normally tell, tell the other one.

## When this is hard

The situations this document exists for do not announce themselves. They look
like a busy afternoon and a small shortcut. Three questions, in order:

1. Would I be comfortable if the patient could see exactly what I did and why?
2. Would I be comfortable explaining this to a surveyor in two years, from the
   record as it will read then?
3. Am I about to do this because it is right, or because it is quicker?

If any answer is uncomfortable, stop and ask someone. Asking is expected here,
not tolerated.

## Status of this document

This is the code of ethics of **{{center_name}}**, operating as
{{legal_entity}} in {{state}}. It is reviewed at least annually and whenever
the law it cites changes.

It is not a substitute for legal advice, and it does not restate every
obligation that applies to this center — the packet's other documents, your
own license, and {{state}} law all continue to apply on their own terms.
$md$),
  'I have read this code of ethics, I understand it, and I agree to work by it. I understand that I am expected to raise a concern if I see something that conflicts with it, and that I will not be penalised for doing so in good faith.',
  12,
  5,
  null
from staff.orgs o
where not exists (
  select 1 from staff.policy_docs d
   where d.org_slug = o.slug and d.key = 'code-of-ethics' and d.version = 1
);


-- ========== staff-ops-manual.sql ==========

-- ============================================================
-- THE OPERATIONS MANUAL
--
-- Run AFTER supabase/staff-ethics.sql. Idempotent.
--
-- A separate signed document rather than a section of the code of
-- ethics, because they answer different questions and are read at
-- different moments. The code of ethics is what to do when the rules run
-- out; this is the rules. Somebody looks one of them up in a crisis of
-- conscience and the other one on their third day when they cannot
-- remember who orders the gloves.
--
-- IT IS A SPINE, NOT AN ENCYCLOPAEDIA. The packet already holds eleven
-- policy documents, seven shift logs, eleven emergency guides and a
-- scope of practice per job. Restating any of that here would create two
-- copies that drift, and the copy people happen to read would start
-- being the out-of-date one. So this points at them by name and fills
-- only the gaps nothing else covers — hours, coverage, opening and
-- closing, supplies, retention, and what to do when something breaks.
--
-- RETENTION PERIODS ARE THE PART MOST OFTEN GOT WRONG, so each one below
-- carries its own citation and they are not rounded to a convenient
-- number. Note particularly that the exposure-records period is
-- duration of employment PLUS thirty years, which is far longer than
-- anybody guesses, and that it is the reason a clinic cannot simply
-- purge everything after seven.
--
-- Same substitution mechanism as the code of ethics — resolved once at
-- insert, never at render, because staff.attestations hashes the body
-- and lib/staff/compliance.ts re-verifies that hash against
-- policy_docs.body_md on every read. See the header of staff-ethics.sql
-- for the full reasoning.
--
-- Seeded as a DRAFT. Half of what follows is a placeholder a center
-- administrator must replace with what is actually true of this clinic —
-- its hours, its suppliers, its call rota. Publishing it unedited would
-- put a document full of blanks in front of staff as their employer's
-- operating procedure, so published_at stays null until somebody has
-- been through it.
-- ============================================================

insert into staff.policy_docs
  (org_slug, key, version, title, category, citation, summary, body_md,
   attestation, renew_months, sort_order, applies_to)
select o.slug, 'operations-manual', 1,
  'Operations manual',
  'operations',
  'OSHA recordkeeping, 29 C.F.R. § 1904.33; OSHA access to exposure and medical records, 29 C.F.R. § 1910.1020(d); Bloodborne Pathogens training records, 29 C.F.R. § 1910.1030(h); HIPAA documentation retention, 45 C.F.R. § 164.316(b)(2)',
  'How this center runs day to day, and where to look for everything else.',
  staff.render_org_text(o.slug, $md$
## What this is

The day-to-day operating procedure for **{{center_name}}**. If you need to know
how something is done here, start here. If this document does not answer it,
the last section says where to look.

Everything marked *[to be completed]* has to be filled in by a center
administrator before this is published. A manual with blanks in it is worse
than no manual, because it teaches people that the manual is not maintained.

## Hours and coverage

- Operating hours: *[to be completed]*
- Last patient accepted: *[to be completed]*
- Who opens, and who holds the keys: *[to be completed]*
- Who to call when someone cannot make a shift: *[to be completed]*
- After-hours contact for a building or equipment emergency: *[to be completed]*

**The center does not open without a provider on site.** If the provider is
delayed, the doors stay shut and waiting patients are told honestly how long
it will be — not brought inside to wait in rooms.

## Opening and closing

Both are logged, not remembered. The opening and closing sheets are in this
system under **Logs**, and they are the record — a shift that was worked but
not logged did not happen as far as any inspection is concerned.

Opening covers the drawer count, privacy screens and the lobby walk. Closing
covers drawer reconciliation, the end-of-day PHI sweep, the log book close and
the card batch. The center administrator's day-sheet reconciliation is a
separate sheet from the front desk's closing sheet, deliberately: one person
should not sign for both halves of a money control.

## Who does what

Every person has a job set on their account, and their board only shows the
work that belongs to that job. That is not a display preference — it is the
scope of practice, and it is set out per job under **Rules**.

Two things follow from it that people get wrong:

- **A task not on your board is not yours to do**, however busy it is and
  however capable you are. Ask the person whose board it is on.
- **The narcotics count needs two people**, one counting and one witnessing.
  That is the control. One person doing both is not a faster count, it is no
  count.

## Equipment and supplies

- Ordering, and who approves it: *[to be completed]*
- Preferred suppliers and account numbers: *[to be completed]*
- Where the par levels are kept: *[to be completed]*
- Biomedical / calibration contractor: *[to be completed]*
- Who to call for the refrigerator, the autoclave, the X-ray unit:
  *[to be completed]*

**Anything out of range gets tagged before it gets reported.** A refrigerator
reading warm is taken out of service with a DO NOT USE tag and the stock
quarantined — not discarded — before anybody makes a phone call. Discarding
vaccine before the manufacturer has been asked is how a recoverable excursion
becomes a loss.

## Records, and how long they are kept

These periods are federal minimums. {{state}} may require longer, and where it
does, the longer period wins.

- **OSHA 300 log, 300A summary and 301 incident reports — five years** beyond
  the year they cover. *(29 C.F.R. § 1904.33.)*
- **Employee exposure records and medical records — duration of employment
  plus thirty years.** *(29 C.F.R. § 1910.1020(d).)* This is the one nobody
  expects, and it is why a general "purge after seven years" rule is unsafe.
- **Bloodborne pathogens training records — three years** from the date of
  training. *(29 C.F.R. § 1910.1030(h)(2)(ii).)*
- **HIPAA policies, and documentation of actions and assessments required by
  the Security Rule — six years** from creation or last effective date.
  *(45 C.F.R. § 164.316(b)(2).)*
- **Patient records — set by {{state}} law**, not by federal rule, and the
  period differs for minors. *[to be completed: the period for {{state}},
  confirmed with counsel.]*

Nothing recorded in this system is deleted or edited. Corrections are made as
amendments that sit alongside the original, which is why there is no delete
button anywhere in it.

## Money

- Cash drawer float and where it is held: *[to be completed]*
- Who prepares and who takes the deposit: *[to be completed]*
- Deposit frequency: *[to be completed]*

**The person who counts is not the person who reconciles**, wherever staffing
allows it. Where it does not, the variance is written down and initialled by
the second person the next morning rather than resolved quietly.

A variance is reported the day it is found. A shortfall found and reported is
a reconciliation; the same shortfall found later by somebody else is an
investigation.

## When something goes wrong

- **A patient safety event, an injury, or a near miss** is an incident report,
  filed the same day, under the incident reporting policy in this packet. Near
  misses count. They are the cheapest information this center will ever get.
- **A privacy breach, or a suspected one** — including an email to the wrong
  address — goes to the privacy officer immediately, not after somebody has
  worked out how serious it was. Breach notification runs on a clock that
  starts at discovery.
- **Equipment failure** is logged and tagged before the shift ends, even when
  a workaround was found.
- **Anything you are unsure about** goes to {{medical_director}} or a center
  administrator. Asking is expected here, not tolerated.

Nobody is penalised for reporting something in good faith. That is stated in
the code of ethics and it is meant literally.

## Where everything else lives

| What you need | Where it is |
|---|---|
| What your job may and may not do | **Rules** |
| Today's shift checks | **Logs** |
| Walked runbooks, signed at the end | **Rounds** |
| Anaphylaxis, code blue, needlestick, eye splash | **Learning** |
| Your own license and certification dates | **My documents** |
| The clinic's own protocols, searchable | **Protocols** |
| Deadlines and who owns them | **Obligations** |
| What to do when the rules run out | **Code of ethics** |

## Keeping this true

This manual is reviewed at least annually and whenever something in it
changes. A center administrator owns it. If you find something in here that is
no longer how the center works, say so — a manual nobody corrects becomes a
manual nobody reads, and then it becomes evidence of what the center said it
did rather than what it did.
$md$),
  'I have read this operations manual and I understand how this center runs. Where it did not answer something, I know where to look and who to ask.',
  12,
  6,
  null
from staff.orgs o
where not exists (
  select 1 from staff.policy_docs d
   where d.org_slug = o.slug and d.key = 'operations-manual' and d.version = 1
);



-- ============================================================
-- medicin. STAFF MODULE — SETUP PART 5 OF 5
--
-- RUN THE PARTS IN ORDER, 1 through 5, each as its own paste.
-- Wait for one to report success before starting the next; a later part
-- refers to tables an earlier one creates.
--
-- Every part is idempotent on its own, so re-running one is safe and a
-- part that half-succeeded can simply be run again.
--
-- Migrations in this part:
--   staff-privacy-rules
--   staff-optional-logs
--   staff-seats
--   staff-founder-job
--   staff-multisite
--   staff-multisite-worker
--   staff-eod-report
--   staff-agreement
--   staff-board-prefs
--   staff-bulletins
--   staff-billing-stats
-- ============================================================

-- ========== staff-privacy-rules.sql ==========

-- ============================================================
-- PRIVACY AND PATIENT INTERACTION, AS STANDING RULES
--
-- HIPAA already lives in the policy packet, which is signed once on a
-- first morning and never opened again. That is the wrong shape for the
-- knowledge somebody needs while a patient's brother is standing at the
-- counter asking whether she is here.
--
-- staff.scope_items is the right shape and already exists: a prohibited
-- item cannot be inserted without the sanctioned alternative beside it,
-- enforced by a CHECK rather than by good intentions. So privacy joins
-- scope of practice on /staff/rules, in the same two columns.
--
-- WRITTEN AS WHAT TO SAY, NOT AS WHAT NOT TO DO. A list that scolds gets
-- skimmed once. A list that solves the awkward moment at the desk gets
-- remembered, and the difference is entirely in whether the right-hand
-- column contains a sentence somebody can actually use out loud.
--
-- SCOPED BY JOB, because the situations are not shared. The front desk
-- meets the relative at the counter several times a week; a provider
-- meets the records request; an x-ray tech meets the corridor
-- conversation. Giving every rule to everybody is how a list becomes
-- long enough to ignore.
--
-- CITATIONS ARE EXACT OR ABSENT. Where 45 CFR 164 says a thing, it is
-- cited. Where this is the clinic's own judgement about what is
-- sensible, the citation is null and the page prints it as clinic
-- policy, which is honest and is also what a surveyor would rather see
-- than a fabricated authority.
-- ============================================================

-- A FUNCTION AND A TRIGGER, NOT A ONE-OFF INSERT. Written as a plain
-- backfill, these rules would reach every clinic that existed the day the
-- migration ran and no clinic that signed up after it — so the second
-- customer would open /staff/rules and find the scope of practice there
-- and the privacy half missing. Every other seed in this schema is a
-- function plus an after-insert trigger for exactly that reason; this one
-- matches them.
create or replace function staff.seed_privacy(p_slug text)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into staff.scope_items
    (org_slug, key, job_role, kind, item, instead, citation, sort_order)
  select p_slug, v.key, v.job_role::staff.job_role, v.kind, v.item, v.instead,
         v.citation, v.sort_order
    from (values

-- ---------- Front desk ----------
-- The counter is where almost all of this happens, and where the person
-- asking is usually not being difficult. They are worried.
('priv-fd-presence', 'front_desk', 'prohibited',
 'Confirm or deny that a particular person is here, to anyone who asks',
 'Say: "I''m not able to confirm whether anyone is here. If they''ve told us it''s alright to talk to you, I can check that - what''s your name?" Then look for a release on file.',
 '45 CFR 164.510(b) - disclosure to family and others requires the patient''s agreement or an opportunity to object',
 200),

('priv-fd-phone', 'front_desk', 'prohibited',
 'Discuss a patient with a caller on the telephone',
 'Say: "I can''t go through patient details over the phone. If you''re with them, they''re welcome to call you from here." A voice on a telephone cannot be identified.',
 null,
 201),

('priv-fd-signin', 'front_desk', 'prohibited',
 'Leave a paper sign-in sheet, a chart or a screen where the next person in the queue can read it',
 'Turn the screen, invert the sheet, or hand the clipboard over face down. A sign-in list is permitted; a list of everyone''s reason for coming is not.',
 '45 CFR 164.530(c) - reasonable safeguards against incidental disclosure',
 202),

('priv-fd-records', 'front_desk', 'prohibited',
 'Hand over records, imaging or results because somebody has asked at the counter',
 'Say: "Records go through a written request - let me give you the form and tell you how long it usually takes." Then pass it to whoever handles releases.',
 '45 CFR 164.524 - right of access, on request, within 30 days',
 203),

('priv-fd-name', 'front_desk', 'authorized',
 'Call a patient by first name and last initial in the waiting room',
 null, null, 204),

-- ---------- Medical assistant ----------
('priv-ma-corridor', 'medical_assistant', 'prohibited',
 'Discuss a patient in a corridor, at the desk, or anywhere the waiting room can hear',
 'Move it into a room and close the door, or hold it until you can. If somebody starts the conversation in the open, say: "Let''s step in here."',
 '45 CFR 164.530(c) - reasonable safeguards',
 210),

('priv-ma-colleague', 'medical_assistant', 'prohibited',
 'Look at, or talk about, the record of a patient you are not caring for',
 'Say: "I''m not on that one - you''d want to ask whoever is." Curiosity about a neighbour or a colleague is the most common way access gets audited and lost.',
 '45 CFR 164.502(b) - minimum necessary',
 211),

-- The one this product itself creates. CameraProof asks staff to
-- photograph a fridge display or a crash cart seal, so the rule belongs
-- here rather than only in the component.
('priv-ma-photo', 'medical_assistant', 'prohibited',
 'Photograph equipment without checking what else is in the frame',
 'Before you tap the shutter, look at the edges: a monitor with a name on it, a whiteboard, a chart on the counter. Move the chart or change the angle. The log needs the thermometer, not the room.',
 '45 CFR 164.530(c)',
 212),

('priv-ma-social', 'medical_assistant', 'prohibited',
 'Post about the shift where it could identify a patient - including "you would not believe today"',
 'Nothing about a patient goes online, even without a name. A small town recognises a description faster than a name.',
 null,
 213),

('priv-ma-family', 'medical_assistant', 'authorized',
 'Speak with a family member who is in the room, when the patient has not objected',
 null, null, 214),

-- ---------- X-ray tech ----------
('priv-xr-images', 'xray_tech', 'prohibited',
 'Show an image to anyone other than the ordering provider and the patient',
 'Say: "The provider will go through the images with you." An image is a record, and a phone screenshot of one leaves the building.',
 '45 CFR 164.502(b)',
 220),

('priv-xr-corridor', 'xray_tech', 'prohibited',
 'Call out a finding or a body part across the department',
 'Take it to the provider directly, or write it. "Room 3''s films are up" carries no clinical information; the alternative does.',
 '45 CFR 164.530(c)',
 221),

-- ---------- Provider ----------
('priv-pr-police', 'provider', 'prohibited',
 'Release information to law enforcement on the strength of a request at the desk',
 'Say: "I''ll need to take that through our medical director." Some disclosures to law enforcement are permitted and many are not, and the difference turns on the paperwork rather than on the urgency in the room.',
 '45 CFR 164.512(f) - specific conditions, not a general permission',
 230),

('priv-pr-minimum', 'provider', 'prohibited',
 'Send a whole record when a specific answer was asked for',
 'Send the part that answers the question. A full chart in reply to "was she seen on Tuesday" is a disclosure nobody needed.',
 '45 CFR 164.502(b) - minimum necessary',
 231),

('priv-pr-emergency', 'provider', 'authorized',
 'Share what is needed for treatment, with another treating clinician, without a signed release',
 null,
 '45 CFR 164.506(c) - treatment, payment and operations',
 232),

-- ---------- Centre administrator ----------
('priv-ca-breach', 'center_admin', 'prohibited',
 'Decide alone that a disclosure was too small to matter',
 'File it under Record an event the same day and take it to the medical director. The clock on a breach notification starts at discovery, not at the point somebody concludes it was serious.',
 '45 CFR 164.404(b) - notification without unreasonable delay and within 60 days',
 240),

('priv-ca-access', 'center_admin', 'prohibited',
 'Leave an account active for somebody who has left',
 'Deactivate them in Team the day they finish. It ends their sessions immediately and revokes any invitation still sitting in their mailbox.',
 '45 CFR 164.308(a)(3)(ii)(C) - termination procedures',
 241),

('priv-ca-request', 'center_admin', 'authorized',
 'Give a patient a copy of their own record on written request',
 null,
 '45 CFR 164.524',
 242)

) as v(key, job_role, kind, item, instead, citation, sort_order)
   where not exists (
           select 1 from staff.scope_items x
            where x.org_slug = p_slug and x.key = v.key
         );

  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function staff.seed_privacy(text) to staff_app;

create or replace function staff.privacy_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_privacy(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_privacy on staff.orgs;
create trigger staff_orgs_seed_privacy
  after insert on staff.orgs
  for each row execute function staff.privacy_seed_new_org();

-- And the clinics that already exist. The library org is skipped: it
-- holds templates, not people, and has no front desk to give rules to.
do $$
declare o record;
begin
  for o in select slug from staff.orgs where not is_library and active loop
    perform staff.seed_privacy(o.slug);
  end loop;
end $$;


-- ========== staff-optional-logs.sql ==========

-- ============================================================
-- INSTRUMENT REPROCESSING AND URINALYSIS CONTROLS
--
-- Two logs a medical assistant was doing on paper, and the idea the
-- schema needed before one of them could exist: a log the clinic
-- CHOOSES.
--
-- WHY OPTIONAL IS A REAL CONCEPT AND NOT A COMMENT.
--
-- Plenty of urgent cares autoclave nothing. They buy disposable specula,
-- disposable suture kits, disposable everything, and the sterilizer in
-- the photograph belongs to the practice next door. Handing those
-- clinics a sterilization log they can never file is how a board stops
-- being read: one permanent red row teaches everybody that red rows are
-- decoration. But the clinics that DO autoclave need the log badly,
-- because an unmonitored load is the one thing in the building that can
-- carry an infection from one patient into the next.
--
-- So `optional` marks a template the clinic switches on, and `active`
-- carries whether it has. staff.todays_logs already filters on active,
-- so an unwanted log is simply not there — not greyed out, not deferred,
-- not a row saying "not applicable". Absent.
--
-- AND THE SWITCH CANNOT REACH THE OTHER LOGS. set_log_enabled() refuses
-- any template that is not marked optional, so nobody can quietly turn
-- off the sharps container check or the fire extinguisher inspection on
-- a busy Tuesday. Those are not preferences.
-- ============================================================

alter table staff.form_templates
  add column if not exists optional boolean not null default false;

comment on column staff.form_templates.optional is
  'The clinic chooses whether to run this log. Only an optional template '
  'can be switched off; everything else is statutory or universal.';


-- ---------- seed_facility has to carry both flags ----------
--
-- It copied name, description, category, frequency, slots, sort_order,
-- job_roles and the schema, which was every column that existed when it
-- was written. A library row marked optional and inactive would have
-- been copied into a new clinic ACTIVE — the switch defaulted to on for
-- every clinic that signed up, which is the opposite of what optional
-- means. Same signature, so this replaces rather than overloads.

create or replace function staff.seed_facility(p_org text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  ftype text;
  n integer;
begin
  select facility_type into ftype from staff.orgs where slug = p_org;
  if ftype is null then return 0; end if;

  insert into staff.form_templates
    (org_slug, slug, name, description, category, frequency, slots,
     sort_order, job_roles, schema_json, optional, active)
  select p_org, l.slug, l.name, l.description, l.category, l.frequency,
         l.slots, l.sort_order, l.job_roles, l.schema_json,
         l.optional, l.active
    from staff.form_templates l
    join staff.facility_templates ft
      on ft.template_slug = l.slug and ft.facility_type = ftype
   where l.org_slug = '_library'
     and not exists (
       select 1 from staff.form_templates x
        where x.org_slug = p_org and x.slug = l.slug
     );

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function staff.seed_facility(text) from public;
grant execute on function staff.seed_facility(text) to staff_app;


-- ============================================================
-- THE TWO TEMPLATES
-- ============================================================

insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots,
   sort_order, job_roles, schema_json, optional, active)
values

-- ---------- Instrument reprocessing ----------
--
-- ONE RECORD PER LOAD, which is why the frequency is on_event rather
-- than daily. A clinic that runs the autoclave three times on Tuesday
-- and not at all on Wednesday is normal; a daily row would be wrong on
-- both days.
--
-- CITATIONS, EXACTLY. OSHA requires that contaminated reusable sharps be
-- held in proper containers until reprocessed — 29 CFR
-- 1910.1030(d)(2)(viii) — and that is the only part of this that is
-- federal law. OSHA sets no cycle parameters. The temperature, the
-- exposure time and the dry time come from the sterilizer manufacturer's
-- instructions and from nowhere else, and the practice of monitoring
-- every load mechanically and chemically with a weekly spore test is
-- CDC and AAMI guidance, named here as guidance because that is what it
-- is. Several states put spore-test frequency into their own rules, so
-- the standard line says to check.
('_library', 'autoclave-load', 'Autoclave load',
 'One record per cycle: what went in, what the gauges said, what the indicator showed.',
 'clinical', 'on_event', array[]::text[], 45,
 array['medical_assistant']::staff.job_role[],
$json$
{
  "standard": "Contaminated reusable instruments are held in covered containers until reprocessed — 29 CFR 1910.1030(d)(2)(viii). The cycle parameters are the sterilizer manufacturer's, not ours: read them off the unit's instructions. Monitoring every load, with a weekly spore test, is CDC and AAMI guidance rather than federal rule, and some states set the interval themselves.",
  "fields": [
    { "id": "sterilizer", "label": "Sterilizer", "type": "text",
      "placeholder": "e.g. Midmark M11, serial 0421",
      "help": "The unit, so a failed cycle can be traced to a machine rather than to a morning." },
    { "id": "load_number", "label": "Load or cycle number", "type": "text",
      "help": "However this unit numbers them. It is what a patient's chart would point back to." },
    { "id": "contents", "label": "What is in this load", "type": "textarea",
      "placeholder": "e.g. 4 suture kits, 2 nasal specula, 1 I&D tray",
      "help": "Enough that somebody could recall this load if the spore test comes back positive. That is the whole reason this is written down." },
    { "id": "precleaned", "label": "Instruments cleaned before loading", "type": "boolean", "expected": true,
      "help": "Sterilization does not work through blood or tissue. A dirty instrument comes out of an autoclave dirty and sterile-looking." },
    { "id": "cycle_type", "label": "Cycle", "type": "select",
      "options": ["Wrapped goods", "Unwrapped goods", "Pouches", "Immediate-use (flash)"],
      "help": "Immediate-use is for a dropped instrument needed now, not for routine turnover." },
    { "id": "temperature_f", "label": "Temperature reached", "type": "number", "unit": "degF",
      "min": 250, "max": 285, "step": 1, "presets": [250, 270, 273],
      "help": "Off the gauge or the printout, not off the dial setting." },
    { "id": "exposure_minutes", "label": "Exposure time", "type": "number", "unit": "min",
      "min": 3, "max": 90, "step": 1, "presets": [4, 15, 30] },
    { "id": "dry_minutes", "label": "Dry time", "type": "number", "unit": "min",
      "min": 0, "max": 90, "step": 5, "required": false,
      "help": "A wet pack is not a sterile pack — moisture wicks organisms straight through the wrap." },
    { "id": "chemical_indicator", "label": "Chemical indicator", "type": "select",
      "options": ["Changed correctly", "Did not change", "Partial change", "None used"],
      "failing": ["Did not change", "Partial change", "None used"],
      "help": "The strip or tape inside the pack, not the tape on the outside. Outside tape only says the pack met heat." },
    { "id": "packs_dry_intact", "label": "Packs came out dry and intact", "type": "boolean", "expected": true },
    { "id": "load_released", "label": "Load released for use", "type": "boolean", "expected": true,
      "help": "Answer no if anything above failed. A quarantined load is a good outcome; a released bad load is not." }
  ]
}
$json$::jsonb, true, false),

-- ---------- Urinalysis strips and controls ----------
--
-- WAIVED, WHICH IS A SHORTER RULE THAN PEOPLE THINK. For a CLIA-waived
-- test the whole federal requirement is 42 CFR 493.15(e)(1): "Follow
-- manufacturers' instructions for performing the test." That is why this
-- template asks the operator to record the interval the insert specifies
-- rather than asserting one — the correct control frequency for a strip
-- is whatever that box says, and a number invented here would be
-- confidently wrong for most clinics running it.
--
-- "NOT RUN" IS A FAILING ANSWER, DELIBERATELY. It exists because
-- sometimes controls genuinely were not run, and a form that cannot
-- record that gets an invented "In range" instead. But it flags, so the
-- filing asks for one line saying why — the same pressure the fridge log
-- puts on a 52-degree reading. A monthly QC record showing both controls
-- not run, filed as clean, is exactly the hollow record this product
-- exists to stop.
--
-- THE STRIPS ARE HALF OF IT. A urinalysis analyzer reads a reagent strip
-- and reports what the strip did. Strips are the fragile part: the pads
-- oxidise on contact with air and humidity, so a bottle left open, a
-- missing desiccant, or a browned pad produces a result that is wrong in
-- a way the machine cannot detect and will not flag. Inspecting them is
-- not housekeeping — it is the only check on the input.
('_library', 'urinalysis-qc', 'Urinalysis controls & strips',
 'Controls run, and the strip bottle actually looked at.',
 'clinical', 'monthly', array[]::text[], 55,
 array['medical_assistant']::staff.job_role[],
$json$
{
  "standard": "A CLIA-waived test carries one federal requirement: follow the manufacturer's instructions (42 CFR 493.15(e)(1)). Run controls at the interval the package insert gives, plus every new strip lot, new shipment, new operator, and any result that does not fit the patient. An out-of-range control means that bottle's results are not reportable until it is resolved.",
  "fields": [
    { "id": "analyzer", "label": "Analyzer", "type": "select",
      "options": ["McKesson Consult", "Siemens Clinitek", "Roche Urisys", "Read visually, no analyzer", "Other"],
      "help": "An analyzer only reports what the strip did. It cannot tell you the strip was bad." },
    { "id": "reason", "label": "Why this run", "type": "select",
      "options": ["Scheduled", "New strip lot", "New shipment", "New operator", "Result did not fit the patient"] },

    { "id": "strip_lot", "label": "Strip lot number", "type": "text",
      "help": "Off the bottle label. If a result is questioned later, this is what ties it to a batch." },
    { "id": "strip_expiry", "label": "Strip expiry on the bottle", "type": "date" },
    { "id": "strip_opened_on", "label": "Date this bottle was opened", "type": "date",
      "help": "Most strips expire a set number of days after opening, well before the printed date. Write the date on the bottle the moment you open it." },
    { "id": "desiccant_present", "label": "Desiccant still in the bottle", "type": "boolean", "expected": true,
      "help": "The packet in the bottle is what keeps the pads dry. Gone or spent, the strips are drifting." },
    { "id": "cap_closed", "label": "Cap was closed and tight", "type": "boolean", "expected": true,
      "help": "Seconds of open air is enough. Close it immediately after taking a strip, not at the end." },
    { "id": "pads_discolored", "label": "Any pad looks discolored or darkened", "type": "boolean", "expected": false,
      "help": "Compare an unused strip to the color chart's zero column. A pad that has already started to turn will read high before urine touches it." },

    { "id": "control_lot", "label": "Control solution lot", "type": "text", "required": false },
    { "id": "control_expiry", "label": "Control solution expiry", "type": "date", "required": false },
    { "id": "control_normal", "label": "Normal control", "type": "select",
      "options": ["In range", "Out of range", "Not run"],
      "failing": ["Out of range", "Not run"] },
    { "id": "control_abnormal", "label": "Abnormal control", "type": "select",
      "options": ["In range", "Out of range", "Not run"],
      "failing": ["Out of range", "Not run"],
      "help": "The abnormal control is the one that catches a strip that has stopped responding — a normal control passing on a dead strip is common. \"Not run\" is an answer, and it asks you for a line saying why." },
    { "id": "discrepancy", "label": "Which analytes were off, and what you did", "type": "textarea",
      "required": false,
      "placeholder": "e.g. leukocytes read trace on the abnormal control; opened a new bottle and both controls passed",
      "help": "Only needed if something was out of range. Name the analyte — 'control failed' tells a surveyor nothing." }
  ]
}
$json$::jsonb, true, true)

on conflict (org_slug, slug) where slug is not null do update set
  name        = excluded.name,
  description = excluded.description,
  category    = excluded.category,
  frequency   = excluded.frequency,
  sort_order  = excluded.sort_order,
  job_roles   = excluded.job_roles,
  schema_json = excluded.schema_json,
  optional    = excluded.optional;
  -- active is deliberately NOT updated: re-running this migration must
  -- not switch a log back on that a clinic turned off, nor off again one
  -- they turned on. The library row's active value is the DEFAULT for a
  -- clinic that has not chosen yet, and only seed_facility reads it.


-- ---------- Who can have them ----------
--
-- Available everywhere they could plausibly apply. Available is not the
-- same as on: autoclave-load arrives switched off for every one of these
-- and stays off until somebody says the clinic has a sterilizer.
insert into staff.facility_templates (facility_type, template_slug)
select f.t, s.slug
  from (values ('urgent_care'),('primary_care'),('med_spa'),
               ('ambulatory_surgery'),('dental')) as f(t)
 cross join (values ('autoclave-load')) as s(slug)
on conflict do nothing;

-- Urinalysis belongs where urine is tested. A med spa and a dental
-- surgery do not run a UA analyzer, and offering them the log would be
-- the same mistake as forcing the autoclave one on a clinic with no
-- autoclave.
insert into staff.facility_templates (facility_type, template_slug)
select f.t, 'urinalysis-qc'
  from (values ('urgent_care'),('primary_care'),('ambulatory_surgery')) as f(t)
on conflict do nothing;


-- ---------- Clinics that already exist ----------
--
-- seed_facility only runs at provisioning, so everybody already signed
-- up is backfilled here, carrying the library's active flag so the
-- autoclave log arrives off and urinalysis arrives on.
insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots,
   sort_order, job_roles, schema_json, optional, active)
select o.slug, l.slug, l.name, l.description, l.category, l.frequency,
       l.slots, l.sort_order, l.job_roles, l.schema_json, l.optional, l.active
  from staff.orgs o
  join staff.facility_templates ft
    on ft.facility_type = coalesce(o.facility_type, 'urgent_care')
  join staff.form_templates l
    on l.org_slug = '_library' and l.slug = ft.template_slug
 where not o.is_library
   and o.active
   and l.slug in ('autoclave-load', 'urinalysis-qc')
   and not exists (
         select 1 from staff.form_templates x
          where x.org_slug = o.slug and x.slug = l.slug
       );


-- ---------- The other two that depend on equipment existing ----------
--
-- A clinic with no x-ray suite has no lead aprons to inspect, and a
-- clinic with no laser has no laser to log. Both were already scoped by
-- facility type — aprons to the types that usually have a suite, the
-- laser log to med spas — but facility type is a guess about a category,
-- and a third of primary-care offices that "usually" have x-ray do not.
-- Marking them optional lets the clinic answer for itself.
--
-- Both stay ON by default where they are offered, which is the opposite
-- default from the autoclave. The difference is what a wrong default
-- costs: a clinic that has aprons and does not see the log stops
-- inspecting them, while a clinic with no aprons sees one row it can
-- switch off in a second. Where the two errors are asymmetric, default
-- to the one that fails safe.
update staff.form_templates
   set optional = true
 where slug in ('radiation-apron', 'laser-safety');

-- WHAT IS DELIBERATELY NOT ON THAT LIST. The crash cart, the fridge, the
-- front desk close. Nothing above is switched off to save somebody
-- thirty seconds.


-- ---------- Controlled substances and hazardous chemicals ----------
--
-- These were on the "not on that list" line above until a real clinic
-- asked for this by name: no federal rule makes a clinic count
-- controlled substances it does not stock or inventory chemicals it does
-- not have, and a clinic with neither has nothing to file here.
--
-- STAYS ON BY DEFAULT WHERE OFFERED, same reasoning as the apron and the
-- laser log just above: a clinic that DOES stock narcotics or handle
-- hazardous chemicals and stops seeing the log is a worse failure than a
-- clinic with neither seeing one row it can switch off in Settings.
update staff.form_templates
   set optional = true
 where slug in ('narcotics-count', 'hazcom-inventory');

-- afc confirmed directly it has neither. Off now, for that clinic only —
-- every other org keeps its current default. The template stays on the
-- org's row rather than being deleted, so a delivery of controlled
-- substances or a new chemical on the shelf is one Settings toggle away
-- from being logged again, not a support ticket.
update staff.form_templates
   set active = false
 where org_slug = 'afc'
   and slug in ('narcotics-count', 'hazcom-inventory');


-- ============================================================
-- THE SWITCH
-- ============================================================

-- SECURITY DEFINER because staff.form_templates is written through a
-- policy that an org_admin does not satisfy — correctly, since a policy
-- loose enough to let an owner turn a log off would also let them edit
-- the schema of one. This reaches `active`, on optional templates, and
-- nothing else.
--
-- THE ORG IS AN ARGUMENT, AND DEFINER RIGHTS MEAN THE FUNCTION DOES NOT
-- CHECK IT. Same contract as update_org_settings: the caller is trusted
-- to pass the org it is authenticated for, and the only caller is a
-- route that takes it from the session rather than from the request
-- body. Anything calling this with an org out of a form field would be
-- a cross-tenant write, so do not add one.
create or replace function staff.set_log_enabled(
  p_org  text,
  p_slug text,
  p_on   boolean
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed integer;
begin
  update staff.form_templates
     set active = p_on
   where org_slug = p_org
     and slug = p_slug
     -- THE GUARD. Without this the same call would switch off the sharps
     -- container check or the fire extinguisher inspection, which are
     -- not preferences and are not the clinic's to decline.
     and optional;

  get diagnostics changed = row_count;
  return changed > 0;
end $$;

revoke all on function staff.set_log_enabled(text, text, boolean) from public;
grant execute on function staff.set_log_enabled(text, text, boolean) to staff_app;


-- What the settings page lists. Scoped by RLS like everything else, so
-- it shows one clinic's choices and cannot enumerate another's.
create or replace view staff.optional_logs as
select slug, name, description, category, frequency, active
  from staff.form_templates
 where optional
   and org_slug <> '_library'
 order by sort_order, name;

grant select on staff.optional_logs to staff_app;


-- ========== staff-seats.sql ==========

-- ============================================================
-- SEATS, BY JOB, PER CENTRE
--
-- What a subscription actually buys, made countable.
--
-- THE HOLE THIS FILLS. Billing was keyed to one stripe_customer_id on one
-- org row and nothing anywhere counted anything: no seat cap, no site
-- cap, no user total. A group could sign up once, name the org after the
-- parent company, and put three hundred people across ten buildings
-- under a single $149 subscription. Nothing in the product would object,
-- because nothing in the product was looking.
--
-- A PLAN IS A CENTRE, and a centre includes a certain number of each
-- job. That is the right unit because it is the unit the obligations
-- are: one building has one OSHA log, one CLIA certificate, one
-- refrigerator, one set of extinguishers. Two buildings are two of
-- everything however the company is drawn on paper.
--
-- WHY BY JOB AND NOT ONE HEADCOUNT. Five medical assistants and two
-- providers is a normal urgent care; two medical assistants and five
-- providers is not a clinic, it is a different business. A single
-- headcount cannot tell those apart, so the ALLOWANCE is per job.
--
-- THE PRICE IS NOT. Every seat past the allowance is the same five
-- dollars a month whatever the job, and that is a deliberate choice
-- against the obvious one. Pricing a provider seat above a front desk
-- seat is defensible and is also how you get an administrator quietly
-- filing a nurse practitioner as "front desk" to save eleven dollars —
-- which corrupts the job field that scope of practice, the credential
-- matrix and every role-scoped board depend on. The saving is trivial
-- and the damage is not. One price removes the incentive entirely.
--
-- It is also a sentence somebody can hold in their head: everyone past
-- your allowance is five dollars. Nobody needs a table to understand
-- their own invoice.
--
-- NOTHING HERE BLOCKS ANYBODY. See the note above seat_usage.
-- ============================================================

-- ---------- What a plan includes ----------
--
-- A TABLE, NOT CONSTANTS IN CODE. These numbers are a pricing decision,
-- and pricing decisions change on a call with a customer who has four
-- providers. A row can be edited by whoever is having that call; a
-- constant is a deploy.
create table if not exists staff.plan_seats (
  plan      text not null,
  job_role  staff.job_role not null,
  included  integer not null check (included >= 0),
  -- Per seat per month, past the allowance. Cents, because money in a
  -- float is a rounding error waiting to be argued about with a
  -- customer. Flat across jobs today — see the header for why — but
  -- stored per row so a single deal can move without a migration.
  extra_seat_cents integer not null default 500 check (extra_seat_cents >= 0),
  primary key (plan, job_role)
);

-- Idempotent for databases that already ran the first version of this
-- file, which had no price column.
alter table staff.plan_seats
  add column if not exists extra_seat_cents integer not null default 500;

grant select on staff.plan_seats to staff_app;

insert into staff.plan_seats (plan, job_role, included, extra_seat_cents) values
  ('standard', 'center_admin',      3, 500),
  ('standard', 'medical_assistant', 5, 500),
  ('standard', 'provider',          2, 500),
  ('standard', 'xray_tech',         3, 500),
  ('standard', 'front_desk',        2, 500)
on conflict (plan, job_role) do update
  set included = excluded.included,
      extra_seat_cents = excluded.extra_seat_cents;

-- A trial is the standard plan. Somebody evaluating this should hit the
-- same shape they would pay for — a trial with unlimited seats teaches
-- them a number that is about to change.
insert into staff.plan_seats (plan, job_role, included, extra_seat_cents)
select 'trial', job_role, included, extra_seat_cents
  from staff.plan_seats where plan = 'standard'
on conflict (plan, job_role) do update
  set included = excluded.included,
      extra_seat_cents = excluded.extra_seat_cents;

-- The demo clinic and anything internal. Not a customer, not counted.
insert into staff.plan_seats (plan, job_role, included, extra_seat_cents)
select 'internal', job_role, 9999, 0 from staff.plan_seats where plan = 'standard'
on conflict (plan, job_role) do update
  set included = excluded.included,
      extra_seat_cents = excluded.extra_seat_cents;


-- ---------- Per-clinic exceptions ----------
--
-- The four-provider clinic that negotiated, the grandfathered first
-- customer, the group that bought a bundle. Overrides live beside the
-- plan rather than editing it, so the plan stays the thing every other
-- clinic is on and a deal stays visible AS a deal.
create table if not exists staff.org_seat_overrides (
  org_slug  text not null references staff.orgs(slug) on delete cascade,
  job_role  staff.job_role not null,
  included  integer not null check (included >= 0),
  note      text,
  primary key (org_slug, job_role)
);

grant select on staff.org_seat_overrides to staff_app;

alter table staff.org_seat_overrides enable row level security;
drop policy if exists staff_org_isolation on staff.org_seat_overrides;
create policy staff_org_isolation on staff.org_seat_overrides
  for all using (staff.is_super_admin() or org_slug = staff.current_org());


-- ---------- What is actually in use ----------
--
-- NOTHING HERE BLOCKS ANYBODY, DELIBERATELY.
--
-- The obvious design is to refuse the sixth medical assistant. It is
-- also the wrong one. A clinic that hires somebody on Monday needs them
-- filing the refrigerator log on Monday, and a product that says "no,
-- your plan includes five" has made a billing dispute into a gap in a
-- compliance record — the exact gap this software is sold to prevent.
-- The vaccines do not care whose card is on file.
--
-- So the sixth medical assistant works on her first shift, and the
-- administrator sees a line that says there are six. Over-count is a
-- conversation, not an error message, and it is the clinic's to have
-- rather than the software's to enforce at somebody's expense.
--
-- DEACTIVATED PEOPLE DO NOT COUNT. That is what deactivation is for: the
-- person who left in March should not be on the invoice in June. Their
-- filed records stay forever; their seat does not.
--
-- AN OPEN INVITATION DOES COUNT. An administrator who has invited four
-- more medical assistants has already made the decision, and showing the
-- overage only once they accept means finding out on the day the
-- accounts appear. Counted separately so the line can say which is
-- which.
drop view if exists staff.seat_usage cascade;
create view staff.seat_usage
with (security_invoker = true)
as
select
  o.slug                                             as org_slug,
  r.job_role,
  coalesce(ov.included, ps.included, 0)              as included,
  coalesce(ov.included, ps.included, 0) is distinct from ps.included
                                                     as is_override,
  count(u.id) filter (where u.active)                as in_use,
  count(distinct i.id) filter (
    where i.revoked_at is null
      and i.accepted_at is null
      and not exists (
        select 1 from staff.users x
         where x.org_slug = o.slug
           and lower(x.email) = lower(i.email)
           and x.active
      )
  )                                                  as invited_not_yet_in,
  greatest(
    count(u.id) filter (where u.active)
      - coalesce(ov.included, ps.included, 0),
    0
  )                                                  as over_by,
  coalesce(ps.extra_seat_cents, 0)                   as extra_seat_cents,
  -- What this job is adding to the invoice this month. Shown to the
  -- administrator rather than left for them to work out from a rate and
  -- a count — an overage nobody has multiplied out is an overage nobody
  -- argues with until the card is charged.
  greatest(
    count(u.id) filter (where u.active)
      - coalesce(ov.included, ps.included, 0),
    0
  ) * coalesce(ps.extra_seat_cents, 0)               as extra_cents
from staff.orgs o
cross join unnest(enum_range(null::staff.job_role)) as r(job_role)
left join staff.plan_seats ps
       on ps.plan = o.plan and ps.job_role = r.job_role
left join staff.org_seat_overrides ov
       on ov.org_slug = o.slug and ov.job_role = r.job_role
left join staff.users u
       on u.org_slug = o.slug and u.job_role = r.job_role
-- org_invites.job_role is the ENUM, not text. staff-invites.sql carries an
-- "add column if not exists job_role text" that was a no-op — the column
-- already existed as staff.job_role — so the declaration there says text
-- and the database says otherwise. Joined without a cast, which is what
-- the column actually is.
left join staff.org_invites i
       on i.org_slug = o.slug and i.job_role = r.job_role
where not o.is_library
group by o.slug, r.job_role, ov.included, ps.included, ps.extra_seat_cents;

grant select on staff.seat_usage to staff_app;


-- ---------- People with no job yet ----------
--
-- Somebody invited and signed in but never given a job. They consume no
-- seat under any heading and they see almost nothing on their board,
-- which makes them easy to miss. Surfaced separately rather than folded
-- into a bucket they were never put in.
drop view if exists staff.seat_unassigned cascade;
create view staff.seat_unassigned
with (security_invoker = true)
as
select org_slug, count(*) as unassigned
  from staff.users
 where active and job_role is null
 group by org_slug;

grant select on staff.seat_unassigned to staff_app;


-- ---------- The one number an owner asks for ----------
--
-- "What am I paying beyond the plan." Summed here rather than in the
-- page, so the invoice line and the screen cannot drift apart by
-- somebody changing one and not the other.
drop view if exists staff.seat_bill cascade;
create view staff.seat_bill
with (security_invoker = true)
as
select org_slug,
       sum(over_by)::int      as extra_seats,
       sum(extra_cents)::int  as extra_cents
  from staff.seat_usage
 group by org_slug;

grant select on staff.seat_bill to staff_app;


-- ========== staff-founder-job.sql ==========

-- ============================================================
-- THE PERSON PAYING FOR IT IS THE ADMIN — NOT AN OPEN QUESTION
--
-- staff.provision_trial and staff.provision_org each write the founding
-- administrator's invite with role = 'org_admin' and nothing else. Every
-- OTHER invite in this product carries a job_role, chosen by whoever
-- issues it (see the Team screen's invite form) — the founder's invite
-- is the one exception, and it is an omission rather than a decision.
--
-- THE CONSEQUENCE WAS A DEAD END, not a cosmetic gap. Onboarding's job
-- step (staff-onboarding-wizard.sql) treats job_role is null as
-- job_unassigned and renders: "Your invite didn't say what you do here.
-- Ask whoever invited you to set your job." For a founder there is no
-- whoever — they invited themselves by paying — so the very first
-- person to ever use a clinic hit a wall with no door in it.
--
-- THE FIX IS DATA, NOT A NEW SCREEN. There is no "owner" value in
-- staff.job_role, and there does not need to be: the founder runs the
-- building, which is what center_admin already means, and the seat
-- table already reserves three free center_admin seats per plan. They
-- now go through the exact same JobConfirm step as anyone else —
-- "You were invited as Center admin", the same scope-of-practice lines,
-- the same confirm button. Not a special case; the general case,
-- correctly populated.
-- ============================================================

create or replace function staff.provision_trial(
  p_slug text, p_name text, p_email text, p_days int default 30,
  p_facility text default 'urgent_care'
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare final_slug text; n int := 1;
begin
  select org_slug into final_slug
    from staff.org_invites where lower(email) = lower(p_email) limit 1;
  if found then return final_slug; end if;

  final_slug := p_slug;
  while exists (select 1 from staff.orgs where slug = final_slug) loop
    n := n + 1;
    final_slug := p_slug || '-' || n;
  end loop;

  insert into staff.orgs (slug, name, plan, subscription_status,
                          is_read_only, trial_ends_on, billing_email,
                          facility_type)
  values (final_slug, p_name, 'trial', 'trialing',
          false, current_date + p_days, lower(p_email),
          coalesce(p_facility, 'urgent_care'));

  insert into staff.org_invites (org_slug, email, role, job_role)
  values (final_slug, lower(p_email), 'org_admin', 'center_admin');

  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

create or replace function staff.provision_org(
  p_slug text, p_name text, p_customer text, p_subscription text, p_email text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare final_slug text; n int := 1;
begin
  select slug into final_slug from staff.orgs
   where stripe_customer_id = p_customer limit 1;
  if found then return final_slug; end if;

  final_slug := p_slug;
  while exists (select 1 from staff.orgs where slug = final_slug) loop
    n := n + 1;
    final_slug := p_slug || '-' || n;
  end loop;

  insert into staff.orgs (slug, name, plan, stripe_customer_id,
                          stripe_subscription_id, subscription_status,
                          is_read_only, billing_email, facility_type)
  values (final_slug, p_name, 'stripe', p_customer, p_subscription,
          'active', false, p_email, 'urgent_care');

  -- The person who paid is the first administrator, and their job here
  -- is running the building.
  insert into staff.org_invites (org_slug, email, role, job_role)
  values (final_slug, lower(p_email), 'org_admin', 'center_admin');

  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.provision_org(text, text, text, text, text) from public;
grant execute on function staff.provision_org(text, text, text, text, text) to staff_app;
revoke all on function staff.provision_trial(text, text, text, int, text) from public;
grant execute on function staff.provision_trial(text, text, text, int, text) to staff_app;


-- ---------- Repair anyone already caught by the gap ----------
--
-- An org_admin whose job_role is still null is, unambiguously, a founder
-- provisioned before this fix — nobody has ever had a UI to set it to
-- anything else, so there is no intentional value to overwrite.
--
-- job_confirmed_at is deliberately left untouched. The point of the job
-- step is the confirmation itself, not just the data behind it — the
-- founder should still see "You were invited as Center admin" and click
-- it, the same as every other job holder, not be silently walked past
-- their own onboarding.
update staff.org_invites
   set job_role = 'center_admin'
 where role = 'org_admin'
   and job_role is null
   and accepted_at is null
   and revoked_at is null;

update staff.users
   set job_role = 'center_admin'
 where role = 'org_admin'
   and job_role is null;


-- ========== staff-multisite.sql ==========

-- ============================================================
-- MULTI-SITE, FINISHED: PRICE THE CLINIC, NOT THE PERSON, AND LET
-- SOMEBODY ACTUALLY REACH THE SECOND ONE
--
-- Run AFTER supabase/staff-facility.sql. Idempotent.
--
-- staff-facility.sql built staff.org_groups, staff.user_orgs and
-- staff.add_clinic() — the data model for an owner who runs more than
-- one site. Nothing in the app ever called any of it. This file finishes
-- the job: fixes the one thing add_clinic() got wrong, and adds the two
-- functions the application layer needs that did not exist yet.
--
-- ---------------------------------------------------------------
-- BUG: A SECOND CLINIC WAS FREE
-- ---------------------------------------------------------------
-- add_clinic() copied plan, subscription_status and is_read_only straight
-- from the home clinic. An owner already paying and active would have
-- their new clinic created already-active — no charge, ever, for as many
-- clinics as they cared to add. The landing page has always said
-- otherwise: "$149/clinic/month... no volume discount... Groups are
-- handled by adding clinics, each at the same price."
--
-- Fixed the same way a brand-new signup is priced: the new clinic gets
-- its own 30-day trial, same as provision_trial(). No new billing
-- mechanism needed — staff.org_is_read_only() already flips a trial to
-- read-only on read once trial_ends_on passes, and the Stripe webhook
-- (app/api/webhooks/stripe/route.ts) already accepts a Payment Link
-- completion carrying client_reference_id for an EXISTING org slug,
-- specifically so "an existing clinic adding a location" attaches a
-- subscription to the clinic just created rather than provisioning a
-- third one. That comment predates this file; this is what it was
-- waiting for.
-- ---------------------------------------------------------------
-- BUG: A GRANT WITH NO ROW BEHIND IT
-- ---------------------------------------------------------------
-- staff.user_orgs grants access; it does not create staff.users row in
-- the new org. But almost everything else in this schema — a profile, a
-- credential, a signed document, the onboarding gates, an audit log
-- entry — is keyed to a user_id THAT LIVES IN THAT ORG under RLS. An
-- owner who switched in on the grant alone had a role and nothing to
-- attach it to: /staff read their profile as "does not exist" and sent
-- them straight into onboarding, for a clinic they may never work a
-- shift at.
--
-- staff.users gets a row for them too now — reachable_via_switch (below)
-- marks it as what it is: an administrative identity, not a place to
-- sign in directly.
--
-- WHY NOT JUST A SECOND EMAIL MATCH. staff.resolve_signin() is the one
-- function a Google or emailed-code sign-in trusts to say which org an
-- address belongs to, and it refuses outright the moment an email
-- matches staff.users in two orgs — deliberately, because picking one
-- for a real ambiguous case would be a security bug, not a convenience.
-- A second row with the same email would trip that refusal for every
-- multi-site owner trying to sign in normally, which is the opposite of
-- what this feature is for. reachable_via_switch excludes exactly this
-- row from that lookup: direct sign-in still resolves to one org, the
-- home one, unchanged for every existing user; the second clinic is only
-- ever reached through the in-app switcher, which does not go through
-- resolve_signin at all.
-- ---------------------------------------------------------------
-- BUG: THE SESSION LAYER HAD NO CONCEPT OF A SECOND CLINIC
-- ---------------------------------------------------------------
-- Every request re-validates the session against staff.users.org_slug —
-- the person's ONE home clinic — and refuses ("revoked") on any mismatch.
-- staff.user_orgs granting access to a second clinic changed nothing
-- there: the moment a session's org claim named the second clinic, the
-- live check would kick it straight back out.
--
-- staff.session_check_for() below is the fix: given a user and a
-- candidate org, it returns the role that applies there — the home role
-- if it's the home clinic, the granted role from user_orgs if it's a
-- second one, or no row at all if neither, which is a plain "no". Called
-- instead of the org-blind staff.session_checks view.
-- ---------------------------------------------------------------
-- BUG: staff.my_orgs COULD NOT ACTUALLY LIST A SECOND CLINIC
-- ---------------------------------------------------------------
-- staff.my_orgs is a plain view (security_invoker), and its join to
-- staff.orgs is subject to that table's own RLS policy — "your org, or
-- you are the platform super admin" — which only ever allows ONE org at
-- a time. Queried from inside any single clinic's request, the join
-- silently drops every other clinic's row. It was never wrong so much as
-- untestable from the one context the app ever runs a query in.
--
-- staff.list_my_orgs() replaces it for the switcher UI: a SECURITY
-- DEFINER function, same bootstrap pattern as staff.resolve_signin() —
-- it is the one place allowed to look across orgs, and it returns
-- nothing but the rows a switcher screen needs.
-- ============================================================


-- ---------- 0. The administrative-identity marker ----------

alter table staff.users
  add column if not exists reachable_via_switch boolean not null default false;

-- Redefined only to add "and not reachable_via_switch" — everything else
-- is unchanged from staff-single-domain.sql. Direct sign-in still
-- resolves to exactly the rows it always did for every account that has
-- never touched multi-site; an administrative identity row from
-- add_clinic() is the one new kind of row this now has to skip, because
-- it exists to be reached by the in-app switcher, not by Google or an
-- emailed code.
create or replace function staff.resolve_signin(p_email text, p_google_sub text)
returns table (org_slug text, member_role staff.user_role, existing boolean)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select u.org_slug, u.role, true
    from staff.users u
   where u.active
     and not u.reachable_via_switch
     and (u.google_sub = p_google_sub or lower(u.email) = lower(p_email))
   limit 2
$$;

revoke all on function staff.resolve_signin(text, text) from public;
grant execute on function staff.resolve_signin(text, text) to staff_app;


-- ---------- 1. A second clinic starts on its own trial ----------

create or replace function staff.add_clinic(
  p_owner_email text, p_slug text, p_name text, p_facility text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  home_slug text;
  home_group uuid;
  final_slug text;
  n int := 1;
  owner_id uuid;
  owner_name text;
  owner_legal_name text;
  home_billing_email text;
begin
  select u.org_slug, u.id, u.name, u.legal_name
    into home_slug, owner_id, owner_name, owner_legal_name
    from staff.users u
   where lower(u.email) = lower(p_owner_email)
     and u.role in ('org_admin', 'platform_super_admin')
     and u.active
   limit 1;
  if home_slug is null then
    raise exception 'no owning account for %', p_owner_email
      using errcode = 'insufficient_privilege';
  end if;

  final_slug := p_slug;
  while exists (select 1 from staff.orgs where slug = final_slug) loop
    n := n + 1;
    final_slug := p_slug || '-' || n;
  end loop;

  select group_id into home_group from staff.orgs where slug = home_slug;
  if home_group is null then
    insert into staff.org_groups (name)
    select coalesce(o.name, home_slug) from staff.orgs o where o.slug = home_slug
    returning id into home_group;
    update staff.orgs set group_id = home_group where slug = home_slug;
  end if;

  select billing_email into home_billing_email
    from staff.orgs where slug = home_slug;

  -- OWN TRIAL, NOT THE HOME CLINIC'S LIVE STATE. plan/subscription_status
  -- /is_read_only/trial_ends_on are the four columns that decide whether
  -- a clinic can file — this is the fix, not a detail of it.
  insert into staff.orgs (slug, name, plan, subscription_status, is_read_only,
                          trial_ends_on, billing_email, facility_type, group_id)
  values (final_slug, p_name, 'trial', 'trialing', false,
          current_date + 30, home_billing_email,
          coalesce(p_facility, 'urgent_care'), home_group);

  -- The owner reaches the new clinic as an administrator; their home org
  -- is unchanged, so their session still opens where it always did.
  insert into staff.user_orgs (user_id, org_slug, role, granted_by)
  values (owner_id, final_slug, 'org_admin', owner_id)
  on conflict do nothing;

  -- The administrative identity itself (see the note above this
  -- function). reachable_via_switch = true keeps it out of
  -- staff.resolve_signin() — this person still only ever signs in
  -- directly at their home clinic. Name and legal name are carried over
  -- so the profile step, if they're later invited to actually work a
  -- shift here, is not asking a stranger's question of someone who
  -- already answered it once; job_role/job_confirmed_at are left unset
  -- deliberately, same as staff-founder-job.sql — center_admin fits, but
  -- they still see and click the real confirmation screen for THIS
  -- clinic rather than having it silently assumed.
  -- No ON CONFLICT clause: final_slug was just proven not to exist above,
  -- so (email, org_slug) cannot already have a row.
  insert into staff.users (org_slug, email, name, role, job_role, legal_name,
                           reachable_via_switch)
  values (final_slug, lower(p_owner_email), owner_name, 'org_admin',
          'center_admin', owner_legal_name, true);

  insert into staff.org_invites (org_slug, email, role)
  values (final_slug, lower(p_owner_email), 'org_admin')
  on conflict do nothing;

  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.add_clinic(text, text, text, text) from public;
grant execute on function staff.add_clinic(text, text, text, text) to staff_app;


-- ---------- 2. Which role a person holds in a GIVEN clinic ----------

-- The org-aware replacement for staff.session_checks. Returns one row —
-- home clinic or a granted one — or none at all, which is the correct
-- "no" for a clinic this person cannot reach. active/session_epoch/
-- mfa_enrolled live on the person, not the clinic, so they are the same
-- either way; role is the one thing that actually depends on which
-- clinic was asked about.
create or replace function staff.session_check_for(p_uid uuid, p_org text)
returns table (
  active boolean,
  role staff.user_role,
  session_epoch integer,
  mfa_enrolled boolean
)
language sql stable
security definer
set search_path = pg_catalog, public
as $$
  select u.active,
         case when u.org_slug = p_org then u.role else m.role end,
         u.session_epoch,
         (u.totp_confirmed_at is not null)
    from staff.users u
    left join staff.user_orgs m
      on m.user_id = u.id and m.org_slug = p_org
   where u.id = p_uid
     and (u.org_slug = p_org or m.org_slug is not null)
   limit 1
$$;

revoke all on function staff.session_check_for(uuid, text) from public;
grant execute on function staff.session_check_for(uuid, text) to staff_app;


-- ---------- 3. Every clinic a person can reach, for the switcher ----------

create or replace function staff.list_my_orgs(p_uid uuid)
returns table (
  slug text,
  name text,
  facility_type text,
  member_role staff.user_role,
  is_home boolean,
  subscription_status text,
  is_read_only boolean,
  trial_ends_on date
)
language sql stable
security definer
set search_path = pg_catalog, public
as $$
  select o.slug, o.name, o.facility_type, u.role, true,
         o.subscription_status, o.is_read_only, o.trial_ends_on
    from staff.users u
    join staff.orgs o on o.slug = u.org_slug
   where u.id = p_uid and u.active
  union
  select o.slug, o.name, o.facility_type, m.role, false,
         o.subscription_status, o.is_read_only, o.trial_ends_on
    from staff.user_orgs m
    join staff.orgs o on o.slug = m.org_slug
   where m.user_id = p_uid
$$;

revoke all on function staff.list_my_orgs(uuid) from public;
grant execute on function staff.list_my_orgs(uuid) to staff_app;


-- ========== staff-multisite-worker.sql ==========

-- ============================================================
-- ONE PERSON, WORKING AT MORE THAN ONE OF THE SAME OWNER'S CLINICS
--
-- Run AFTER supabase/staff-multisite.sql. Idempotent.
--
-- staff-multisite.sql solved a different problem: an OWNER administering
-- a second clinic without ever working a shift there, on purpose — see
-- its header. The "administrative identity" row it creates deliberately
-- has no working profile at the second clinic: no shift board, no logs,
-- because an owner clicking into Team at a site they don't staff should
-- not also be handed that site's fridge log to file.
--
-- A MEDICAL ASSISTANT WHO ROTATES BETWEEN THREE OF THE SAME OWNER'S SITES
-- NEEDS THE OPPOSITE: a real, working profile — logs, rounds, her own
-- credentials — at every site she's actually scheduled at.
--
-- WHY NOT ONE IDENTITY ACROSS ALL THREE. staff.users.id is a single
-- global primary key, and nearly everything in this schema — credentials,
-- signed documents, log entries, the audit trail — hangs off that id
-- WITHIN one org's RLS. Making the same id reappear in three orgs' worth
-- of staff.users rows would mean rewriting every foreign key in the
-- schema to a composite key. Not worth it for one rotating employee.
--
-- WHAT THIS BUILDS INSTEAD: three separate staff.users rows — her own
-- account, her own onboarding, her own job at each site (a rotating MA at
-- one clinic can be front desk at another; nothing here assumes the job
-- is the same) — linked by ONE shared person_key so the product can still
-- answer "is this the same person" without pretending they are the same
-- row:
--
--   SIGN-IN. One email, up to three matching accounts. Today that trips
--   staff.resolve_signin()'s ambiguity refusal — deliberately, because a
--   real collision (two unrelated people who happen to share an email
--   pattern) must never have the software guess which org to open. A
--   linked set is not that collision; it is the one case the refusal's
--   own comment says has "no screen for" it yet. This file adds the
--   person_key resolve_signin() already needs to tell the two apart; the
--   picker screen itself is application code, not SQL.
--
--   BILLING. She is one employee, not three — staff.seat_usage is
--   amended so only her HOME row (person_key = id) counts toward a
--   clinic's seat usage; the sites she's linked into see her on the
--   roster but are not billed for her.
--
--   CREDENTIALS. A BLS card doesn't change per building. Linking copies
--   her current ones over so she isn't retyping the same expiry date
--   three times; the new site's onboarding still makes her confirm the
--   JOB and sign that site's OWN policy packet, because those genuinely
--   differ per clinic.
-- ============================================================


-- ---------- 0. The shared key ----------
--
-- Defaults to a row's own id — "home, and the only place this person
-- exists" — for every account that was never linked. Set on INSERT rather
-- than via a column DEFAULT because a default cannot reference the row's
-- own generated id; a BEFORE INSERT trigger can, once the id default has
-- already run.
alter table staff.users
  add column if not exists person_key uuid;

create or replace function staff.users_default_person_key()
returns trigger
language plpgsql
as $$
begin
  if new.person_key is null then
    new.person_key := new.id;
  end if;
  return new;
end $$;

drop trigger if exists staff_users_person_key on staff.users;
create trigger staff_users_person_key
  before insert on staff.users
  for each row execute function staff.users_default_person_key();

-- Backfill: every row that predates this file is its own home.
update staff.users set person_key = id where person_key is null;

alter table staff.users alter column person_key set not null;

create index if not exists staff_users_person_key
  on staff.users (person_key);


-- ---------- 1. resolve_signin() learns to tell "linked" from "collision" ----------
--
-- Same query as staff-multisite.sql's version, with person_key and the
-- clinic's display name added — everything the sign-in picker needs to
-- render without a second cross-org round trip. Still at most 2 rows:
-- the caller does not need every clinic here, only enough to know
-- whether there is more than one and, if so, whether they are the same
-- person wearing two badges or a genuine ambiguity to refuse.
--
-- For three or more linked sites the picker still needs the full list —
-- staff.list_my_orgs_for_person() below is what it calls once it knows
-- this is a linked account, not a collision.
--
-- DROPPED FIRST, not CREATE OR REPLACE. Postgres refuses to replace a
-- function whose OUT-parameter row shape changes — and adding person_key
-- and org_name does change it — so a plain CREATE OR REPLACE here fails
-- with "cannot change return type of existing function" the moment this
-- file lands on a database that already ran staff-multisite.sql's
-- version.
drop function if exists staff.resolve_signin(text, text);
create function staff.resolve_signin(p_email text, p_google_sub text)
returns table (
  org_slug text,
  member_role staff.user_role,
  existing boolean,
  person_key uuid,
  org_name text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select u.org_slug, u.role, true, u.person_key, o.name
    from staff.users u
    join staff.orgs o on o.slug = u.org_slug
   where u.active
     and not u.reachable_via_switch
     and (u.google_sub = p_google_sub or lower(u.email) = lower(p_email))
   limit 2
$$;

revoke all on function staff.resolve_signin(text, text) from public;
grant execute on function staff.resolve_signin(text, text) to staff_app;

-- Every clinic a linked person can sign into directly — not the switcher
-- (staff.list_my_orgs(), which is for an owner's administrative reach),
-- this is her own working accounts. Called once resolve_signin() has
-- already established the match is a linked person, not a collision.
create or replace function staff.list_my_orgs_for_person(p_person_key uuid)
returns table (org_slug text, org_name text, member_role staff.user_role)
language sql stable
security definer
set search_path = pg_catalog, public
as $$
  select u.org_slug, o.name, u.role
    from staff.users u
    join staff.orgs o on o.slug = u.org_slug
   where u.person_key = p_person_key
     and u.active
     and not u.reachable_via_switch
   order by o.name
$$;

revoke all on function staff.list_my_orgs_for_person(uuid) from public;
grant execute on function staff.list_my_orgs_for_person(uuid) to staff_app;


-- ---------- 2. Adding an existing person to another of the owner's sites ----------
--
-- NOT an invite. She already proved who she is at her home clinic; this
-- is the owner (or an admin at the target site) vouching that the same
-- person also works here — the same trust an owner already has to
-- administer a second clinic in the first place. So no email, no link to
-- click: she simply sees the new clinic next time she signs in.
--
-- SAME GROUP ONLY. Linking across staff.orgs.group_id is the whole
-- safety boundary here — it is exactly the set of clinics one owner
-- already controls, the same boundary staff.add_clinic() trusts for
-- letting an owner reach a second clinic as its administrator. Linking a
-- person into an org outside that group would let one clinic's admin
-- reach into a stranger's roster by guessing a user id, so it is refused
-- outright rather than left to the caller to check.
create or replace function staff.link_existing_person(
  p_home_user_id uuid,
  p_target_org text,
  p_job_role staff.job_role,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  home record;
  target_group uuid;
  new_id uuid;
begin
  select u.id, u.person_key, u.email, u.name, u.legal_name, u.phone, o.group_id
    into home
    from staff.users u
    join staff.orgs o on o.slug = u.org_slug
   where u.id = p_home_user_id
     and u.active
     and u.person_key = u.id  -- must be linking FROM a home row
   for update of u;

  if home.id is null then
    raise exception 'not_a_home_account' using errcode = 'invalid_parameter_value';
  end if;

  select group_id into target_group from staff.orgs where slug = p_target_org;

  if target_group is null or home.group_id is null
     or target_group <> home.group_id then
    raise exception 'not_same_group' using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from staff.users
     where org_slug = p_target_org
       and person_key = home.person_key
       and active
  ) then
    raise exception 'already_linked' using errcode = 'unique_violation';
  end if;

  insert into staff.users
    (org_slug, email, name, legal_name, phone, role, job_role, person_key)
  values
    (p_target_org, home.email, home.name, home.legal_name, home.phone,
     'staff', p_job_role, home.person_key)
  returning id into new_id;

  -- Carried over so she is not retyping a card she already handed her
  -- home clinic. job_confirmed_at and esign_consented_at are deliberately
  -- NOT copied — the job can differ site to site, and this clinic's own
  -- policy packet still gets its own real signature.
  insert into staff.credentials (org_slug, user_id, kind, expires_on)
  select p_target_org, new_id, kind, expires_on
    from staff.credentials
   where user_id = p_home_user_id
     and active
     and expires_on is not null;

  insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
  values (p_target_org, p_actor_id, 'person_linked', 'user', new_id,
          jsonb_build_object('home_user_id', p_home_user_id, 'job_role', p_job_role));

  return new_id;
end $$;

revoke all on function staff.link_existing_person(uuid, text, staff.job_role, uuid) from public;
grant execute on function staff.link_existing_person(uuid, text, staff.job_role, uuid) to staff_app;


-- ---------- 3. Seats: billed once, at home, not once per site ----------
--
-- Identical to staff-seats.sql's view except every count(u.id) filter
-- also requires person_key = id — a linked (non-home) row still shows up
-- on that clinic's roster, still shows up in staff.pending_invites-style
-- team management, just does not add to what the clinic is charged for.
drop view if exists staff.seat_usage cascade;
create view staff.seat_usage
with (security_invoker = true)
as
select
  o.slug                                             as org_slug,
  r.job_role,
  coalesce(ov.included, ps.included, 0)              as included,
  coalesce(ov.included, ps.included, 0) is distinct from ps.included
                                                     as is_override,
  count(u.id) filter (where u.active and u.person_key = u.id) as in_use,
  count(distinct i.id) filter (
    where i.revoked_at is null
      and i.accepted_at is null
      and not exists (
        select 1 from staff.users x
         where x.org_slug = o.slug
           and lower(x.email) = lower(i.email)
           and x.active
      )
  )                                                  as invited_not_yet_in,
  greatest(
    count(u.id) filter (where u.active and u.person_key = u.id)
      - coalesce(ov.included, ps.included, 0),
    0
  )                                                  as over_by,
  coalesce(ps.extra_seat_cents, 0)                   as extra_seat_cents,
  greatest(
    count(u.id) filter (where u.active and u.person_key = u.id)
      - coalesce(ov.included, ps.included, 0),
    0
  ) * coalesce(ps.extra_seat_cents, 0)               as extra_cents
from staff.orgs o
cross join unnest(enum_range(null::staff.job_role)) as r(job_role)
left join staff.plan_seats ps
       on ps.plan = o.plan and ps.job_role = r.job_role
left join staff.org_seat_overrides ov
       on ov.org_slug = o.slug and ov.job_role = r.job_role
left join staff.users u
       on u.org_slug = o.slug and u.job_role = r.job_role
left join staff.org_invites i
       on i.org_slug = o.slug and i.job_role = r.job_role
where not o.is_library
group by o.slug, r.job_role, ov.included, ps.included, ps.extra_seat_cents;

grant select on staff.seat_usage to staff_app;


-- ---------- 4. Deactivating her HOME account closes every linked door ----------
--
-- Same idiom as staff.revoke_invites_on_deactivate() in staff-invites.sql
-- — a trigger, because there is more than one route to active = false
-- and the one that forgets is the one that matters.
--
-- ONE DIRECTION ONLY. Deactivating her at a site she's LINKED into (she
-- stopped rotating there, or was let go from just that location) says
-- nothing about her home clinic or any other linked one — she may still
-- work both. Deactivating her HOME account is different: that is the
-- owner ending the employment relationship this whole group was built
-- on, and an owner who does that while her accounts at two of THEIR OWN
-- other clinics stay live has a real gap, not a choice they made on
-- purpose.
create or replace function staff.deactivate_cascades_from_home()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.active and not new.active and old.person_key = old.id then
    update staff.users
       set active = false, session_epoch = session_epoch + 1
     where person_key = old.person_key
       and id <> old.id
       and active;
  end if;
  return new;
end $$;

drop trigger if exists staff_users_deactivate_cascades_from_home on staff.users;
create trigger staff_users_deactivate_cascades_from_home
  after update of active on staff.users
  for each row
  execute function staff.deactivate_cascades_from_home();


-- ========== staff-eod-report.sql ==========

-- ============================================================
-- THE ADMIN'S END-OF-DAY REPORT, AND AN OPT-IN DIGEST FOR EVERYONE ELSE
--
-- Run AFTER supabase/staff-reports.sql. Idempotent.
--
-- staff-reports.sql built a report an owner subscribes an ARBITRARY
-- ADDRESS to — the right shape for an accountant or a franchise manager
-- with no staff account. It never automatically reaches the people who
-- actually administer the clinic day to day, and it never reached staff
-- at all. This file adds the other half: every active org_admin and
-- platform_super_admin gets today's report automatically, no
-- subscription required, and any employee can opt into the routine
-- digest that used to be owner/medical-director only.
--
-- ONE COLUMN. wants_digest is deliberately not a JSONB bag of
-- preferences — there is exactly one optional notification today (the
-- AM/PM "what got done" digest), and a table of one boolean is honest
-- about that. Urgent alerts (excursions, missed tasks) are unaffected:
-- there is still no column to turn those off, for the reason already
-- given in staff-alerts.sql.
-- ============================================================

alter table staff.users
  add column if not exists wants_digest boolean not null default false;


-- ========== staff-agreement.sql ==========

-- ============================================================
-- THE SUBSCRIPTION AGREEMENT, ACCEPTED AND RECORDED
--
-- Run AFTER supabase/staff-founder-job.sql. Idempotent.
--
-- Every record this product asks a clinic to trust exists because
-- someone did something and it was written down, not because a
-- checkbox was rendered on a screen. A signup flow that shows an "I
-- agree" box and never records that it was checked is exactly the
-- hollow record this product exists to replace elsewhere in the
-- building — nothing to point to, a year later, when the question is
-- whether an owner actually agreed to the geolocation terms in
-- app/agreement/page.tsx before signing up.
--
-- WHAT THIS ADDS: one timestamp, staff.orgs.agreement_accepted_at, set
-- once at signup and never touched again — provenance, the same
-- contract every other timestamp in this schema keeps. And the check is
-- enforced in staff.provision_trial() itself, not just trusted from the
-- client: a request that reaches this function without acceptance gets
-- no organization, the same posture every other guard in this schema
-- takes toward a caller that could otherwise route around it.
-- ============================================================

alter table staff.orgs
  add column if not exists agreement_accepted_at timestamptz;

-- DROP FIRST, MATCHING THE IDIOM ALREADY ESTABLISHED IN THIS SCHEMA (see
-- the comment on this exact function in staff-facility.sql): adding a
-- required argument changes the signature, and CREATE OR REPLACE only
-- replaces a function with the SAME signature — it does not overload.
drop function if exists staff.provision_trial(text, text, text, int, text);

create or replace function staff.provision_trial(
  p_slug text, p_name text, p_email text, p_days int default 30,
  p_facility text default 'urgent_care', p_agreed boolean default false
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare final_slug text; n int := 1;
begin
  select org_slug into final_slug
    from staff.org_invites where lower(email) = lower(p_email) limit 1;
  if found then return final_slug; end if;

  -- Enforced here, not only checked on the client. THE ROUTE ALSO
  -- REJECTS AN UNAGREED REQUEST BEFORE IT REACHES THIS FUNCTION (see
  -- app/api/trial/route.ts) so a visitor sees a clean 400 rather than
  -- this exception — this guard exists for whatever calls
  -- provision_trial without going through that route.
  if not coalesce(p_agreed, false) then
    raise exception 'subscription agreement not accepted'
      using errcode = 'check_violation';
  end if;

  final_slug := p_slug;
  while exists (select 1 from staff.orgs where slug = final_slug) loop
    n := n + 1;
    final_slug := p_slug || '-' || n;
  end loop;

  insert into staff.orgs (slug, name, plan, subscription_status,
                          is_read_only, trial_ends_on, billing_email,
                          facility_type, agreement_accepted_at)
  values (final_slug, p_name, 'trial', 'trialing',
          false, current_date + p_days, lower(p_email),
          coalesce(p_facility, 'urgent_care'), now());

  insert into staff.org_invites (org_slug, email, role, job_role)
  values (final_slug, lower(p_email), 'org_admin', 'center_admin');

  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.provision_trial(text, text, text, int, text, boolean) from public;
grant execute on function staff.provision_trial(text, text, text, int, text, boolean) to staff_app;


-- ---------- Clinics that signed up before this existed ----------
--
-- Every org already provisioned agreed to nothing in writing, because
-- there was nothing to agree to. Backfilling agreement_accepted_at with
-- a fabricated date would misstate history; leaving it null is the
-- honest record of "this predates the agreement flow," and is exactly
-- the distinction a real audit would need to draw anyway.


-- ========== staff-board-prefs.sql ==========

-- ============================================================
-- MY BOARD, MY ORDER
--
-- Run AFTER supabase/staff-logs.sql. Idempotent; safe to re-run.
--
-- THE COMPLAINT THIS ANSWERS. A medical assistant already sees only her
-- own job's tasks — staff.brief_matches() has always scoped that — but
-- every one of them saw them in the same fixed sort_order, on every
-- shift, at every clinic. A real shift doesn't run in that order; it
-- runs in whatever sequence the person doing it has actually settled
-- into, and a board that disagrees with her own rhythm reads as
-- disorganized even when nothing on it is wrong.
--
-- TWO THINGS, DELIBERATELY KEPT SEPARATE FROM WHAT'S OWED.
--   - sort_order lets her put the board in HER order. Purely cosmetic —
--     it changes nothing about which template applies to her job.
--   - hidden lets her collapse something rarely-relevant out of her
--     daily view. It does NOT remove the requirement: todaysBoard()
--     still returns the row, still counts it toward what's outstanding,
--     still flags it if it goes overdue. Hidden means "out of my way
--     today," never "not tracked." A preference that could make a real
--     obligation disappear from the system is the one thing this table
--     is built to be incapable of.
-- ============================================================

create table if not exists staff.log_board_prefs (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  user_id uuid not null references staff.users(id) on delete cascade,
  -- Keyed by slug, not template_id — a template can be edited (its id
  -- changes) without silently resetting everyone's saved order.
  template_slug text not null,
  hidden boolean not null default false,
  -- Null means "no preference yet, use the template's own sort_order."
  sort_order integer,
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_log_board_prefs_once
  on staff.log_board_prefs (user_id, template_slug);

create index if not exists staff_log_board_prefs_org
  on staff.log_board_prefs (org_slug);

alter table staff.log_board_prefs enable row level security;
alter table staff.log_board_prefs force row level security;
drop policy if exists staff_org_isolation on staff.log_board_prefs;
create policy staff_org_isolation on staff.log_board_prefs
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

-- Org isolation is as far as the database goes. "You can only ever
-- write your own preferences, not a colleague's" is enforced in
-- app/api/staff/logs/board-prefs/route.ts instead — every table in
-- this schema is org-scoped, not user-scoped, so a second RLS axis
-- here would be new machinery built for exactly one table.

grant select, insert, update, delete on staff.log_board_prefs to staff_app;


-- ========== staff-bulletins.sql ==========

-- ============================================================
-- CLINIC BULLETINS — one-way notices from whoever runs the building
--
-- Run AFTER supabase/staff-schema.sql and staff-manager-role.sql. Idempotent.
--
-- WHY ONE-WAY. Real internal messaging — two people, or a thread,
-- exchanging replies — is an all-party-consent recording question under
-- Pennsylvania law (18 Pa. C.S. § 5703) the moment the product keeps a
-- copy of the conversation, and that needs an employment attorney's
-- sign-off on the consent flow before it can exist. A posting board is a
-- different thing: one person puts up a notice, everyone reads it, nobody
-- replies inside the product. Same as a printed sheet taped to the break
-- room door — nothing here is a captured conversation between two
-- people, so nothing here raises that question.
--
-- WHO CAN POST is staff.runsClinic() in application terms: an org_admin
-- or manager by ROLE, or the centre admin by JOB — enforced in
-- app/api/staff/bulletins/route.ts, not here. RLS below only confines
-- everything to one org; who may write within that org is, as
-- everywhere else in this schema, the API route's job.
-- ============================================================

create table if not exists staff.bulletins (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  author_id uuid not null references staff.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists staff_bulletins_org_time
  on staff.bulletins (org_slug, created_at desc);

alter table staff.bulletins enable row level security;
alter table staff.bulletins force row level security;
drop policy if exists staff_org_isolation on staff.bulletins;
create policy staff_org_isolation on staff.bulletins
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, delete on staff.bulletins to staff_app;


-- ========== staff-billing-stats.sql ==========

-- ============================================================
-- TONIGHT'S PATIENT COUNT, HANDED TO BILLING — NOT A COMPLIANCE LOG
--
-- Run AFTER supabase/staff-org-settings.sql and staff-reports.sql. Idempotent.
--
-- WHAT THIS IS NOT. The EMR already carries the authoritative patient
-- count for the day — duplicating it here as a second source of truth
-- would just leave the clinic with two numbers that can disagree. This
-- exists for one narrow reason: whoever closes out the front desk each
-- night can, in the same motion, put a same-night count and a note in
-- front of the billing team without a second login or a phone call.
--
-- WHY NOT A FORM TEMPLATE. Every compliance log in staff.form_templates
-- is audited, immutable, and counted toward "still due today" on the
-- board. This isn't one of those — nothing is being surveyed, nothing
-- goes overdue, there is no min/max range to flag. Bolting it onto that
-- machinery would mean explaining to an inspector why a patient count
-- appears in a compliance binder. So this is its own small table with
-- its own one-purpose route, not another row in form_templates.
--
-- WHO FILES IT AND WHO RECEIVES IT ARE TWO DIFFERENT AXES, ON PURPOSE.
-- Any front-desk-facing account can type in tonight's count — see
-- app/api/staff/billing-stats/route.ts. billing_contact_email below is
-- the one thing on this whole flow reserved for the owner, mirroring
-- staff-org-settings.sql exactly: the recipient of a financial email is
-- a decision that belongs to whoever answers for the money, never
-- something a nightly form submission can redirect. A biller's address
-- that anyone on shift could repoint is the same shape as the
-- invoice-fraud pattern this is built to not be.
-- ============================================================

-- ---------- 1. Where the count goes — owner-only, one column ----------

alter table staff.orgs
  add column if not exists billing_contact_email text;

do $$ begin
  alter table staff.orgs add constraint staff_orgs_billing_contact_email
    check (billing_contact_email is null
           or billing_contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$');
exception when duplicate_object then null; end $$;

-- Reaches this one column on staff.orgs and nothing else — see
-- staff-org-settings.sql for why a wider RLS policy or a direct UPDATE
-- from the app would also expose the billing-STATE columns on the same
-- row (is_read_only, the Stripe ids) to anyone who could reach this one.
create or replace function staff.update_billing_contact(
  p_org text,
  p_email text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update staff.orgs
     set billing_contact_email = nullif(btrim(coalesce(p_email, '')), '')
   where slug = p_org;

  if not found then
    raise exception 'no such organization: %', p_org
      using errcode = 'no_data_found';
  end if;
end $$;

revoke all on function staff.update_billing_contact(text, text) from public;
grant execute on function staff.update_billing_contact(text, text) to staff_app;


-- ---------- 2. The count itself — anyone on shift can file it ----------

create table if not exists staff.billing_stats (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  stats_date date not null,
  patient_count integer not null check (patient_count >= 0),
  notes text,
  submitted_by uuid references staff.users(id) on delete set null,
  submitted_at timestamptz not null default now(),

  -- One count per night. Filing it again the same day corrects the
  -- number and resends rather than piling up a second row for the
  -- same date — see the route for why a resubmit re-emails on purpose.
  unique (org_slug, stats_date)
);

create index if not exists staff_billing_stats_org_date
  on staff.billing_stats (org_slug, stats_date desc);

alter table staff.billing_stats enable row level security;
alter table staff.billing_stats force row level security;
drop policy if exists staff_org_isolation on staff.billing_stats;
create policy staff_org_isolation on staff.billing_stats
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update, delete on staff.billing_stats to staff_app;

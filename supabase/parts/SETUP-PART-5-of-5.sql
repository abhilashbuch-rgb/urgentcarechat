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

-- WHAT IS DELIBERATELY NOT ON THAT LIST. The narcotics count, the crash
-- cart, the fridge, the front desk close. A clinic that stocks no
-- controlled substances genuinely does not need a count — but "we do not
-- have any" is a claim that changes with one delivery, and a log the
-- clinic switched off in March is not there to catch it in June. That
-- one stays on and gets filed as "none on site", which is a record.
-- Nothing above is switched off to save somebody thirty seconds.


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
  p_slug text, p_name text, p_email text, p_days int default 14,
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

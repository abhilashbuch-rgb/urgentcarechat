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

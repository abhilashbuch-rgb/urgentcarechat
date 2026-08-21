-- ============================================================
-- THE STATUTORY SPINE — and a board that respects frequency
--
-- SOURCED FROM THE CFR, NOT FROM ANYBODY'S STANDARDS MANUAL. Every
-- record below exists because a federal regulation names it, and the
-- citation on each template is the regulation itself. That is a
-- deliberate choice about provenance: an accreditation manual's wording,
-- ordering and checklists are its publisher's copyright even where the
-- underlying duty is public law, so the manual stays shut and the CFR is
-- the source. It is also the better product — a surveyor arguing with
-- 29 CFR 1910.1030(h)(5) is arguing with the government rather than with
-- us, and the same binder then serves a clinic under any accreditor, or
-- under none.
--
-- ---------------------------------------------------------------
-- FIRST, A BUG THIS WORK CANNOT PROCEED AROUND.
--
-- staff.todays_logs joins instances on due_date = current_date and
-- nothing anywhere filters by frequency. So the quarterly lead-apron
-- check, the monthly POCT controls, the quarterly QI minutes and the
-- weekly eyewash flush have been appearing on the board as unfiled EVERY
-- DAY since they were seeded. Five rows that are permanently red is how
-- a board teaches the person reading it that red means nothing.
--
-- The fix decides "done" over the PERIOD rather than over the day: a
-- weekly task filed on Monday is done until Sunday. Instances stay
-- per-day, so nothing about how a log is opened or written changes.
-- ---------------------------------------------------------------

-- 'on_event' joins the vocabulary: a record that exists because
-- something happened, not because a clock came round. A sharps injury
-- log is the canonical case — putting it on a daily board would mean an
-- item nobody can ever complete, which is worse than not listing it.
comment on column staff.form_templates.frequency is
  'per_shift | daily | weekly | monthly | quarterly | on_event. '
  'on_event templates never appear on the day board; they are filed from '
  'the event entry point and appear in the record and the binder.';

drop view if exists staff.todays_logs cascade;
create view staff.todays_logs
with (security_invoker = true) as
with period as (
  select t.id,
         case t.frequency
           when 'weekly'    then date_trunc('week',    current_date)::date
           when 'monthly'   then date_trunc('month',   current_date)::date
           when 'quarterly' then date_trunc('quarter', current_date)::date
           else current_date
         end as starts_on
    from staff.form_templates t
)
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
  p.starts_on     as period_starts_on,
  u.legal_name    as submitted_by_name,
  u.email         as submitted_by_email
from staff.form_templates t
join period p on p.id = t.id
cross join lateral unnest(
  case when cardinality(t.slots) = 0 then array[''] else t.slots end
) as s(slot)
-- The most recent filing for this template and slot ANYWHERE IN THE
-- CURRENT PERIOD, superseded rows excluded. Lateral rather than a join
-- on today's instance, because "has the weekly eyewash been done this
-- week" cannot be answered by looking only at today.
left join lateral (
  select r2.*
    from staff.form_responses r2
    join staff.form_instances i2 on i2.id = r2.instance_id
   where i2.template_id = t.id
     and i2.slot = s.slot
     and i2.due_date >= p.starts_on
     and not exists (
           select 1 from staff.form_responses newer
            where newer.supersedes_id = r2.id
         )
   order by r2.submitted_at desc
   limit 1
) r on true
left join staff.users u on u.id = r.submitted_by
where t.active
  and t.frequency <> 'on_event';

grant select on staff.todays_logs to staff_app;

-- ============================================================
-- THE TEMPLATES
-- Seeded into the library org; staff.seed_facility copies them into a
-- clinic at provisioning, and the backfill below adds them to clinics
-- that already exist.
-- ============================================================

insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots, sort_order, schema_json)
values

-- ---------- 29 CFR 1910.1030(h)(5) ----------
-- Named in the regulation, required of any employer with employees who
-- have occupational exposure, and one of the most reliably-written-up
-- findings there is, because it is a record that either exists or does
-- not. Recorded WITHOUT the injured person's name: the rule requires the
-- log to protect their identity, and a name column would be the one
-- place in this product where somebody could put one.
('_library', 'sharps-injury', 'Sharps injury log',
 'One entry per percutaneous injury. Required record; no names.',
 'osha', 'on_event', array[]::text[], 300,
$json$
{
  "standard": "29 CFR 1910.1030(h)(5) — the employer shall establish and maintain a sharps injury log, recorded and maintained so as to protect the confidentiality of the injured employee. Retain for the duration of employment plus 30 years (29 CFR 1910.1020(d)).",
  "fields": [
    { "id": "injury_date", "label": "Date of injury", "type": "date" },
    { "id": "device_type", "label": "Type of device", "type": "select",
      "options": ["Hollow-bore needle", "Suture needle", "Lancet", "Scalpel", "Winged steel needle", "IV catheter stylet", "Glass", "Other sharp"],
      "help": "The regulation asks for the type and brand of device involved." },
    { "id": "device_brand", "label": "Brand / manufacturer", "type": "text", "required": false },
    { "id": "engineered_control", "label": "Device had an engineered sharps injury protection", "type": "select",
      "options": ["Yes, and it was activated", "Yes, but not activated", "Yes, it failed", "No such feature", "Unknown"],
      "failing": ["Yes, but not activated", "Yes, it failed"],
      "help": "A protection that failed or went unused is the finding that changes what the clinic buys next." },
    { "id": "department", "label": "Department or work area", "type": "select",
      "options": ["Exam room", "Procedure room", "Triage", "Laboratory / POCT", "Radiology", "Housekeeping", "Other"] },
    { "id": "how_it_happened", "label": "How the incident occurred", "type": "textarea",
      "help": "The task in progress and the mechanism. No patient or employee names." },
    { "id": "exposure_followup_offered", "label": "Post-exposure evaluation offered", "type": "boolean", "expected": true,
      "help": "29 CFR 1910.1030(f)(3) — confidential medical evaluation, made available immediately and at no cost." }
  ]
}
$json$::jsonb),

-- ---------- 29 CFR 1910.157(e)(2) ----------
('_library', 'fire-extinguisher', 'Fire extinguisher check',
 'Monthly visual inspection of every portable extinguisher.',
 'osha', 'monthly', array[]::text[], 310,
$json$
{
  "standard": "29 CFR 1910.157(e)(2) — portable extinguishers shall be visually inspected monthly, and the inspection date recorded. Annual maintenance is a separate professional service (e)(3).",
  "fields": [
    { "id": "units_checked", "label": "Extinguishers inspected", "type": "number", "min": 1, "step": 1 },
    { "id": "all_in_place", "label": "All units in their designated place", "type": "boolean", "expected": true },
    { "id": "access_clear", "label": "Access and signage unobstructed", "type": "boolean", "expected": true },
    { "id": "gauge_in_green", "label": "All gauges in the operable range", "type": "boolean", "expected": true },
    { "id": "pin_seal_intact", "label": "Pins and tamper seals intact", "type": "boolean", "expected": true },
    { "id": "no_damage", "label": "No corrosion, dents or leakage", "type": "boolean", "expected": true },
    { "id": "annual_service_due", "label": "Month of next annual service", "type": "text", "required": false }
  ]
}
$json$::jsonb),

-- ---------- 42 CFR 493.1451(b)(8) / 493.1495(b)(8) ----------
-- Distinct from a credential expiry, which is what the credential matrix
-- already tracks. Currency of a card is not evidence that the person can
-- run the assay.
('_library', 'poct-competency', 'POCT competency assessment',
 'Per testing person: at six months, then annually.',
 'clinical', 'on_event', array[]::text[], 320,
$json$
{
  "standard": "42 CFR 493.1451(b)(8) and 493.1495(b)(8) — competency of each person performing testing is assessed semiannually during the first year and at least annually thereafter, by the six required procedures.",
  "fields": [
    { "id": "assessed_person", "label": "Person assessed", "type": "text",
      "help": "Their name as it appears on the roster." },
    { "id": "assessment_type", "label": "Assessment point", "type": "select",
      "options": ["Six-month (first year)", "Annual", "After a change in method or instrument"] },
    { "id": "direct_observation", "label": "1. Direct observation of routine performance", "type": "boolean", "expected": true },
    { "id": "recording_reporting", "label": "2. Monitoring of recording and reporting", "type": "boolean", "expected": true },
    { "id": "record_review", "label": "3. Review of QC, proficiency and maintenance records", "type": "boolean", "expected": true },
    { "id": "instrument_maintenance", "label": "4. Direct observation of maintenance and function checks", "type": "boolean", "expected": true },
    { "id": "blind_specimens", "label": "5. Blind or previously analysed specimens tested", "type": "boolean", "expected": true },
    { "id": "problem_solving", "label": "6. Problem-solving skills assessed", "type": "boolean", "expected": true },
    { "id": "outcome", "label": "Outcome", "type": "select",
      "options": ["Competent", "Retraining required"], "failing": ["Retraining required"] }
  ]
}
$json$::jsonb),

-- ---------- 29 CFR 1910.1200(e), (g) ----------
('_library', 'hazcom-inventory', 'Hazardous chemical inventory',
 'The chemical list and the safety data sheets behind it.',
 'osha', 'quarterly', array[]::text[], 330,
$json$
{
  "standard": "29 CFR 1910.1200(e)(1)(i) — a list of the hazardous chemicals known to be present; (g)(8) — safety data sheets readily accessible to employees in their work area during each work shift.",
  "fields": [
    { "id": "chemicals_listed", "label": "Chemicals on the list", "type": "number", "min": 0, "step": 1 },
    { "id": "list_matches_shelf", "label": "List reconciled against what is actually stored", "type": "boolean", "expected": true,
      "help": "Walk the shelves. A list that has drifted from the cupboard is the finding." },
    { "id": "sds_present_for_all", "label": "An SDS on hand for every chemical listed", "type": "boolean", "expected": true },
    { "id": "sds_accessible", "label": "SDS reachable by staff without asking a manager", "type": "boolean", "expected": true,
      "help": "Readily accessible during each work shift is the standard — a binder in a locked office is not." },
    { "id": "labels_intact", "label": "Secondary containers labelled", "type": "boolean", "expected": true },
    { "id": "missing_sds_note", "label": "Anything missing, and what was ordered", "type": "textarea", "required": false }
  ]
}
$json$::jsonb),

-- ---------- 29 CFR 1910.1030(f)(3) ----------
('_library', 'exposure-incident', 'Exposure incident follow-up',
 'Post-exposure evaluation for a blood or OPIM exposure.',
 'osha', 'on_event', array[]::text[], 340,
$json$
{
  "standard": "29 CFR 1910.1030(f)(3) — a confidential medical evaluation and follow-up made immediately available at no cost, including documentation of the route of exposure and the circumstances.",
  "fields": [
    { "id": "incident_date", "label": "Date of exposure", "type": "date" },
    { "id": "route", "label": "Route of exposure", "type": "select",
      "options": ["Percutaneous", "Mucous membrane", "Non-intact skin", "Bite", "Other"] },
    { "id": "circumstances", "label": "Circumstances", "type": "textarea",
      "help": "What was being done. No patient identifiers." },
    { "id": "source_identified", "label": "Source individual identified", "type": "select",
      "options": ["Yes", "No", "Identification infeasible / prohibited by law"] },
    { "id": "referred_at", "label": "Referred for evaluation", "type": "select",
      "options": ["Same day", "Next day", "Later", "Declined by employee"],
      "failing": ["Later"] },
    { "id": "hbv_status_offered", "label": "Hepatitis B vaccination status addressed", "type": "boolean", "expected": true },
    { "id": "written_opinion_filed", "label": "Healthcare professional's written opinion on file", "type": "boolean", "expected": true,
      "help": "1910.1030(f)(5) — within 15 days of the evaluation." }
  ]
}
$json$::jsonb),

-- ---------- State licensure; 45 CFR 92 (ACA 1557) ----------
('_library', 'patient-complaint', 'Patient complaint / grievance',
 'One entry per complaint, with what was done about it.',
 'operations', 'on_event', array[]::text[], 350,
$json$
{
  "standard": "State licensure rules generally require a complaint process and a record of resolution; 45 CFR 92 requires a grievance procedure for discrimination complaints at covered entities of 15 or more employees. Check your own state's rule for the response deadline.",
  "fields": [
    { "id": "received_on", "label": "Date received", "type": "date" },
    { "id": "channel", "label": "How it arrived", "type": "select",
      "options": ["In person", "Telephone", "Letter", "Email", "Online review", "Survey", "Other"] },
    { "id": "category", "label": "Nature of the complaint", "type": "select",
      "options": ["Wait time", "Billing", "Clinical care", "Staff conduct", "Access / accommodation", "Privacy", "Facility", "Other"] },
    { "id": "summary", "label": "What was said", "type": "textarea",
      "help": "In their words where possible. No clinical detail beyond what is needed." },
    { "id": "acknowledged_on", "label": "Date acknowledged to the patient", "type": "date", "required": false },
    { "id": "resolution", "label": "What was done", "type": "textarea" },
    { "id": "closed_on", "label": "Date closed", "type": "date", "required": false },
    { "id": "referred_to_md", "label": "Referred to the medical director", "type": "boolean", "required": false,
      "help": "Anything alleging harm should be." }
  ]
}
$json$::jsonb),

-- ---------- Manufacturer IFU; 42 CFR 493.1254 ----------
('_library', 'equipment-calibration', 'Equipment calibration & maintenance',
 'Function checks at the interval the manufacturer sets, and what was done.',
 'clinical', 'monthly', array[]::text[], 360,
$json$
{
  "standard": "42 CFR 493.1254 — maintenance and function checks performed at the frequency the manufacturer specifies. Where the manufacturer is silent, the clinic sets and documents its own interval.",
  "fields": [
    { "id": "asset", "label": "Equipment", "type": "select",
      "options": ["Centrifuge", "Glucometer", "Autoclave", "Vaccine refrigerator", "Vaccine freezer", "Thermometer / data logger", "Pulse oximeter", "ECG", "Nebulizer compressor", "Scale", "Blood pressure device", "X-ray generator", "Other"] },
    { "id": "asset_id", "label": "Asset or serial number", "type": "text", "required": false },
    { "id": "action", "label": "What was done", "type": "select",
      "options": ["Calibration verified", "Calibration adjusted", "Function check", "Preventive maintenance", "Repair", "Removed from service"],
      "failing": ["Removed from service"] },
    { "id": "within_tolerance", "label": "Within manufacturer tolerance", "type": "boolean", "expected": true },
    { "id": "performed_by", "label": "Performed by", "type": "select",
      "options": ["In-house", "Manufacturer", "Third-party service"] },
    { "id": "next_due", "label": "Next due", "type": "date", "required": false }
  ]
}
$json$::jsonb)

-- The unique index on (org_slug, slug) is PARTIAL — `where slug is not
-- null` — so the inference needs the same predicate or Postgres refuses
-- with "no unique or exclusion constraint matching the ON CONFLICT
-- specification".
on conflict (org_slug, slug) where slug is not null do update set
  name        = excluded.name,
  description = excluded.description,
  category    = excluded.category,
  frequency   = excluded.frequency,
  sort_order  = excluded.sort_order,
  schema_json = excluded.schema_json;

-- ============================================================
-- WHO GETS THEM
--
-- Every facility type. A med spa has sharps and chemicals; a dental
-- surgery has an autoclave and an exposure plan; a surgery centre has
-- all of it. These are employer obligations, not urgent-care ones, so
-- the mapping is deliberately universal rather than per-type — unlike
-- the vaccine and laser templates, which genuinely only apply to some.
-- ============================================================

insert into staff.facility_templates (facility_type, template_slug)
select f.t, s.slug
  from (values ('urgent_care'),('primary_care'),('med_spa'),
               ('ambulatory_surgery'),('dental')) as f(t)
 cross join (values ('sharps-injury'),('fire-extinguisher'),('poct-competency'),
                    ('hazcom-inventory'),('exposure-incident'),
                    ('patient-complaint'),('equipment-calibration')) as s(slug)
on conflict do nothing;

-- Clinics that already exist do not run seed_facility again, so they are
-- backfilled here. Same shape as the facility backfill in
-- staff-facility.sql: copy the library row, skip anything the clinic
-- already has under that slug.
insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots, sort_order, schema_json, active)
select o.slug, t.slug, t.name, t.description, t.category, t.frequency,
       t.slots, t.sort_order, t.schema_json, true
  from staff.orgs o
  join staff.facility_templates ft
    on ft.facility_type = coalesce(o.facility_type, 'urgent_care')
  join staff.form_templates t
    on t.org_slug = '_library' and t.slug = ft.template_slug
 where not o.is_library
   and o.active
   and t.slug in ('sharps-injury','fire-extinguisher','poct-competency',
                  'hazcom-inventory','exposure-incident',
                  'patient-complaint','equipment-calibration')
   and not exists (
         select 1 from staff.form_templates x
          where x.org_slug = o.slug and x.slug = t.slug
       );

-- One repair, not a general overwrite. The description this template
-- shipped with was a note to whoever was building it rather than a
-- sentence for the person filling it in, and it reached every clinic
-- seeded before that was noticed. The backfill above deliberately skips
-- a slug the clinic already has, so it cannot correct this; matching on
-- the exact old text does, and leaves alone any clinic that has since
-- written its own.
update staff.form_templates
   set description = 'Function checks at the interval the manufacturer sets, and what was done.'
 where slug = 'equipment-calibration'
   and description = 'The registry flagged as not built when the module shipped.';

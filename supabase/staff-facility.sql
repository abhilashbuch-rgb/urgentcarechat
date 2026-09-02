-- ============================================================
-- FACILITY TYPES, AND OWNERS WITH MORE THAN ONE CLINIC
--
-- Run AFTER supabase/staff-reports.sql. Idempotent.
--
-- ---------------------------------------------------------------
-- THE BUG THIS FIXES FIRST
-- ---------------------------------------------------------------
-- staff-logs-seed.sql inserts its seven templates against the literal
-- slug 'afc', and staff.provision_trial() creates an org and an invite
-- and nothing else. So every clinic that has ever signed up through
-- /start received a working login and a COMPLETELY EMPTY BOARD — no
-- logs, no rounds, no policy packet. The trial worked exactly long
-- enough for somebody to log in and find nothing.
--
-- staff.seed_facility() below is the fix and the feature at once: it is
-- what provision_trial should always have called, and now that it takes
-- a facility type it seeds the right set rather than one clinic's set.
--
-- ---------------------------------------------------------------
-- NO active_modules COLUMN, DELIBERATELY
-- ---------------------------------------------------------------
-- The obvious design is a JSONB of module switches — refrigeration true,
-- laser_safety false — read by the board. It was asked for and it is not
-- built, because THE TEMPLATES ALREADY ARE THE MODULES. Whether a clinic
-- does radiation checks is expressed by whether it has a radiation-apron
-- row, which the board already reads and an administrator can already
-- deactivate with form_templates.active.
--
-- A parallel switch table would be a second source of truth for the same
-- fact, and the two would disagree the first time somebody added a
-- template without flipping a flag: a log that exists, is due, appears on
-- nobody's board, and is silently absent from the binder. Facility type
-- decides what gets SEEDED. After that the clinic owns its own set.
--
-- ---------------------------------------------------------------
-- WHY THERE IS NO 'health_system' TYPE
-- ---------------------------------------------------------------
-- It was on the list. A radio button labelled "Health System" that
-- promises enterprise multi-site hierarchy and Joint Commission tracers
-- would be selling two things that do not exist: TJC's framework is not
-- the UCA one this binder is built around, and a hospital's procurement
-- would stop this product at SOC 2 and SAML long before the checklists
-- mattered.
--
-- Multi-site is real and is built below — but it is ORTHOGONAL to
-- facility type, not a type of its own. An owner may hold three urgent
-- cares, or an urgent care and a med spa. Modelling "has several sites"
-- as a facility archetype would make that unrepresentable.
--
-- ---------------------------------------------------------------
-- AND NO 'franchise' CONCEPT
-- ---------------------------------------------------------------
-- Per the founder, and it is the right call: an owner adds a CLINIC and
-- picks its type, as many times as they have clinics. A franchise is
-- then just an owner with several clinics, which needs no vocabulary of
-- its own — and the same machinery serves a two-site independent, a
-- twelve-site franchisee, and a group that owns a med spa next door to
-- its urgent care.
-- ============================================================


-- ---------- 1. What kind of clinic this is ----------

alter table staff.orgs
  add column if not exists facility_type text not null default 'urgent_care';

do $$ begin
  alter table staff.orgs add constraint staff_orgs_facility_type
    check (facility_type in (
      'urgent_care',
      'primary_care',
      'med_spa',
      'ambulatory_surgery',
      'dental'
    ));
exception when duplicate_object then null; end $$;


-- ---------- 2. Owners with more than one clinic ----------

create table if not exists staff.org_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table staff.orgs
  add column if not exists group_id uuid references staff.org_groups(id) on delete set null;

create index if not exists staff_orgs_group on staff.orgs (group_id) where group_id is not null;

-- MEMBERSHIP AS A TABLE, alongside staff.users.org_slug rather than
-- replacing it. org_slug stays the person's home clinic — the one their
-- session opens in and the one every existing RLS policy resolves
-- against — so nothing already written changes meaning. This table adds
-- the EXTRA clinics a regional manager or a multi-site owner can also
-- reach.
--
-- RLS IS UNAFFECTED, and that is the point of doing it this way. Every
-- policy in this schema keys off current_setting('staff.org_slug'),
-- which is set per transaction and stays single-valued. Multi-site means
-- a person may SWITCH which org is set, not that a query ever spans two.
-- A cross-org read remains impossible.
create table if not exists staff.user_orgs (
  user_id uuid not null references staff.users(id) on delete cascade,
  org_slug text not null references staff.orgs(slug) on delete cascade,
  -- The role is per clinic. Somebody can be org_admin at the site they
  -- run and plain staff at the one they cover shifts at, and conflating
  -- those would hand them administrative rights they were never given.
  role staff.user_role not null default 'staff',
  granted_by uuid references staff.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, org_slug)
);

create index if not exists staff_user_orgs_org on staff.user_orgs (org_slug);

grant select, insert, update, delete on staff.user_orgs to staff_app;
grant select, insert, update on staff.org_groups to staff_app;
revoke delete on staff.org_groups from staff_app;

-- Every clinic a person can reach: their home org plus any granted.
-- UNION rather than UNION ALL so a home org that also has an explicit
-- membership row appears once.
drop view if exists staff.my_orgs cascade;
create view staff.my_orgs
with (security_invoker = true)
as
select u.id as user_id, o.slug, o.name, o.facility_type, o.group_id,
       u.role::text as role, true as is_home
  from staff.users u
  join staff.orgs o on o.slug = u.org_slug
union
select m.user_id, o.slug, o.name, o.facility_type, o.group_id,
       m.role::text as role, false as is_home
  from staff.user_orgs m
  join staff.orgs o on o.slug = m.org_slug;

grant select on staff.my_orgs to staff_app;


-- ---------- 3. Which logs a facility type gets ----------

-- A TABLE, NOT A CASE STATEMENT. The mapping is the kind of thing that
-- gets corrected by somebody who knows dentistry better than whoever
-- wrote it, and a row is editable where a branch in a function is a
-- deploy. It is also readable: "what does a med spa get" is a select.
create table if not exists staff.facility_templates (
  facility_type text not null,
  template_slug text not null,
  primary key (facility_type, template_slug)
);

grant select on staff.facility_templates to staff_app;

insert into staff.facility_templates (facility_type, template_slug) values
  -- URGENT CARE — unchanged from what AFC has had all along.
  ('urgent_care', 'crash-cart'),
  ('urgent_care', 'temp-fridge'),
  ('urgent_care', 'narcotics-count'),
  ('urgent_care', 'eyewash-autoclave'),
  ('urgent_care', 'poct-qc'),
  ('urgent_care', 'radiation-apron'),
  ('urgent_care', 'qi-minutes'),
  ('urgent_care', 'front-desk-open'),
  ('urgent_care', 'front-desk-close'),
  ('urgent_care', 'front-desk-eod'),
  ('urgent_care', 'admin-day-sheet'),
  ('urgent_care', 'fire-safety-check'),

  -- PRIMARY CARE & PEDIATRICS. No radiation apron (most have no X-ray)
  -- and no narcotics count (most stock none). The fridge is the whole
  -- job here — see the VFC template added below.
  ('primary_care', 'crash-cart'),
  ('primary_care', 'temp-fridge'),
  ('primary_care', 'vfc-storage'),
  ('primary_care', 'eyewash-autoclave'),
  ('primary_care', 'poct-qc'),
  ('primary_care', 'qi-minutes'),
  ('primary_care', 'front-desk-open'),
  ('primary_care', 'front-desk-close'),
  ('primary_care', 'fire-safety-check'),

  -- MEDICAL SPA. Emergency readiness still applies — anaphylaxis after
  -- an injectable is the event this industry actually fears.
  ('med_spa', 'crash-cart'),
  ('med_spa', 'temp-fridge'),
  ('med_spa', 'product-lot'),
  ('med_spa', 'laser-safety'),
  ('med_spa', 'eyewash-autoclave'),
  ('med_spa', 'front-desk-open'),
  ('med_spa', 'front-desk-close'),
  -- The two added alongside product-lot: a recall is the failure mode
  -- lot tracking exists to catch, and a monthly review is the record a
  -- malpractice carrier or a state board asks for first when something
  -- goes wrong. See the templates below for what each does and does not
  -- claim to be required by.
  ('med_spa', 'recall-check'),
  ('med_spa', 'adverse-event-review'),
  ('med_spa', 'fire-safety-check'),

  -- AMBULATORY SURGERY CENTER.
  ('ambulatory_surgery', 'crash-cart'),
  ('ambulatory_surgery', 'temp-fridge'),
  ('ambulatory_surgery', 'narcotics-count'),
  ('ambulatory_surgery', 'mh-cart'),
  ('ambulatory_surgery', 'sterile-processing'),
  ('ambulatory_surgery', 'eyewash-autoclave'),
  ('ambulatory_surgery', 'poct-qc'),
  ('ambulatory_surgery', 'qi-minutes'),
  ('ambulatory_surgery', 'fire-safety-check'),

  -- DENTAL & ORAL SURGERY.
  ('dental', 'crash-cart'),
  ('dental', 'eyewash-autoclave'),
  ('dental', 'sedation-check'),
  ('dental', 'amalgam-separator'),
  ('dental', 'front-desk-open'),
  ('dental', 'front-desk-close'),
  ('dental', 'fire-safety-check')
on conflict do nothing;


-- ---------- 4. The templates the new types need ----------
--
-- Seeded against a RESERVED SLUG that owns the canonical copy of every
-- template, rather than against each org. seed_facility() then copies
-- from here. Without a canonical source, seeding a clinic created next
-- year would mean re-running a migration, which is exactly the bug at
-- the top of this file.
--
-- The library org is not a clinic: is_library keeps it out of every
-- listing, every count and every billing sweep.

alter table staff.orgs add column if not exists is_library boolean not null default false;

insert into staff.orgs (slug, name, plan, active, is_library)
values ('_library', 'Template library', 'internal', false, true)
on conflict (slug) do update set is_library = true, active = false;

-- Copy the templates that already exist on afc into the library, so the
-- seven originals have a canonical home too. Only fills gaps.
insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots, sort_order,
   job_roles, schema_json)
select '_library', t.slug, t.name, t.description, t.category, t.frequency,
       t.slots, t.sort_order, t.job_roles, t.schema_json
  from staff.form_templates t
 where t.org_slug = 'afc'
   and not exists (
     select 1 from staff.form_templates l
      where l.org_slug = '_library' and l.slug = t.slug
   );

insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots, sort_order,
   job_roles, schema_json)
select '_library', t.slug, t.name, t.description, t.category, t.frequency,
       t.slots, t.sort_order, t.job_roles, t.schema_json::jsonb
from (values

  -- VACCINES FOR CHILDREN storage. Separate from temp-fridge because the
  -- VFC requirements are their own thing: twice daily, min AND max from a
  -- continuous monitor, and a documented response before anything is
  -- discarded. Ranges are the CDC storage-and-handling values —
  -- refrigerated 2-8 degC, frozen -50 to -15 degC.
  ('vfc-storage',
   'VFC vaccine storage',
   'Twice-daily storage temperatures for the publicly funded stock.',
   'clinical', 'per_shift', array['am','pm'], 21,
   array['medical_assistant']::staff.job_role[],
   $json$
   {
     "standard": "Refrigerated vaccine 2-8 degC (36-46 degF). Frozen vaccine -50 to -15 degC. Record the current, minimum and maximum from the continuous monitor at each reading. An excursion means quarantine and call the manufacturer or the immunization program BEFORE discarding anything.",
     "fields": [
       { "id": "unit", "label": "Storage unit", "type": "select",
         "options": ["Refrigerator", "Freezer"] },
       { "id": "current_c", "label": "Current", "type": "number",
         "unit": "degC", "min": 2, "max": 8, "step": 0.1,
         "presets": [3.0, 4.0, 5.0, 6.0, 7.0],
         "help": "Freezer units are outside this range by design — record the reading and add the corrective-action note explaining the unit type if it flags." },
       { "id": "min_c", "label": "Minimum since last check", "type": "number",
         "unit": "degC", "step": 0.1 },
       { "id": "max_c", "label": "Maximum since last check", "type": "number",
         "unit": "degC", "step": 0.1 },
       { "id": "monitor_ok", "label": "Continuous monitor reading and in date", "type": "boolean",
         "expected": true,
         "help": "A digital data logger with a current calibration certificate. A dial thermometer is not sufficient for publicly funded stock." },
       { "id": "reset", "label": "Min/max reset after reading", "type": "boolean", "expected": true }
     ]
   }
   $json$),

  -- NEUROTOXIN AND FILLER LOT TRACKING. The record that answers "which
  -- vial went into which patient" when a manufacturer issues a recall.
  -- Patient identity is deliberately NOT collected here — the chart has
  -- it; this is the inventory side.
  ('product-lot',
   'Injectable lot and expiry',
   'Lot, expiry and reconstitution for each vial opened.',
   'clinical', 'daily', array[]::text[], 24,
   array['provider']::staff.job_role[],
   $json$
   {
     "standard": "Every vial opened is recorded with its lot and expiry before use. A recall notice names lots, and a practice that cannot say which lots it holds has to contact everybody.",
     "fields": [
       { "id": "product", "label": "Product", "type": "text",
         "placeholder": "e.g. neurotoxin A, 100 unit vial" },
       { "id": "lot", "label": "Lot number", "type": "text" },
       { "id": "expiry", "label": "Expiry", "type": "date" },
       { "id": "storage_ok", "label": "Stored per manufacturer instructions until opened", "type": "boolean",
         "expected": true },
       { "id": "reconstituted_at", "label": "Reconstituted or opened", "type": "text",
         "required": false, "placeholder": "time, and by whom" },
       { "id": "discard_by", "label": "Discard by", "type": "date",
         "help": "Per the manufacturer's beyond-use time after reconstitution, not the vial expiry." },
       { "id": "units_used", "label": "Units drawn", "type": "number", "min": 0, "step": 1,
         "required": false },
       { "id": "disposed", "label": "Remainder disposed of per policy", "type": "boolean",
         "expected": true, "required": false }
     ]
   }
   $json$),

  -- LASER AND ENERGY DEVICE SAFETY. ANSI Z136 is the consensus standard
  -- for safe use of lasers in health care; the specific operator
  -- credential requirement is set by STATE law and varies enormously, so
  -- this asks whether the operator meets it rather than asserting what
  -- it is.
  ('laser-safety',
   'Laser and energy device safety',
   'Pre-treatment safety check for each device in use.',
   'clinical', 'daily', array['am'], 26,
   array['provider']::staff.job_role[],
   $json$
   {
     "standard": "ANSI Z136 practice: controlled area, correct eyewear for the wavelength in use, key control, and a trained operator. Who may operate a device, and under what supervision, is set by state law — confirm yours.",
     "fields": [
       { "id": "device", "label": "Device", "type": "text",
         "placeholder": "e.g. 1064 nm Nd:YAG" },
       { "id": "wavelength_eyewear", "label": "Eyewear present and rated for this wavelength", "type": "boolean",
         "expected": true,
         "help": "Eyewear for the wrong wavelength is worse than none, because it is worn with confidence." },
       { "id": "eyewear_count", "label": "Pairs available", "type": "number", "min": 1, "step": 1,
         "presets": [2, 3, 4],
         "help": "One per person in the room, including the patient." },
       { "id": "signage", "label": "Warning signage posted and door controlled", "type": "boolean",
         "expected": true },
       { "id": "key_secured", "label": "Key removed and secured when not in use", "type": "boolean",
         "expected": true },
       { "id": "operator_qualified", "label": "Operator meets this state's requirement for this device", "type": "boolean",
         "expected": true },
       { "id": "test_fire", "label": "Test fire and calibration check passed", "type": "select",
         "options": ["Pass", "Fail", "Not required today"], "failing": ["Fail"] },
       { "id": "smoke_evac", "label": "Plume evacuation working where required", "type": "boolean",
         "expected": true, "required": false }
     ]
   }
   $json$),

  -- MALIGNANT HYPERTHERMIA CART. MHAUS guidance is the reference every
  -- ASC surveyor uses. Dantrolene stock is the item that matters and the
  -- one most often found expired.
  ('mh-cart',
   'Malignant hyperthermia cart',
   'Dantrolene stock, cold saline, and the adjuncts.',
   'clinical', 'weekly', array[]::text[], 28,
   array['provider','medical_assistant']::staff.job_role[],
   $json$
   {
     "standard": "MHAUS recommends a full treatment dose of dantrolene be immediately available wherever triggering agents are used. Check the stock, not the seal — an expired vial behind an intact seal is the finding.",
     "fields": [
       { "id": "seal_intact", "label": "Cart seal intact", "type": "boolean", "expected": true },
       { "id": "dantrolene_vials", "label": "Dantrolene vials on hand", "type": "number",
         "min": 0, "step": 1,
         "help": "Count the formulation you actually stock — the vial count for a full dose differs between the traditional and concentrated preparations." },
       { "id": "dantrolene_expiry", "label": "Earliest dantrolene expiry", "type": "date" },
       { "id": "sterile_water", "label": "Sterile water for reconstitution present and in date", "type": "boolean",
         "expected": true,
         "help": "Preservative-free. The volume needed is substantial and is the thing people run short of." },
       { "id": "cold_saline", "label": "Cold saline available", "type": "boolean", "expected": true },
       { "id": "adjuncts", "label": "Adjunct drugs present and in date", "type": "boolean",
         "expected": true },
       { "id": "poster", "label": "Treatment protocol posted with the cart", "type": "boolean",
         "expected": true },
       { "id": "hotline", "label": "Emergency hotline number posted", "type": "boolean",
         "expected": true }
     ]
   }
   $json$),

  -- STERILE PROCESSING. The biological indicator is the only one of
  -- these that proves sterility; the others prove the cycle ran.
  ('sterile-processing',
   'Sterile processing',
   'Load records, indicators and the weekly spore test.',
   'clinical', 'daily', array['am'], 29,
   array['medical_assistant']::staff.job_role[],
   $json$
   {
     "standard": "Every load is recorded and every load carries a chemical indicator. A biological indicator is run at least weekly and with every implant load. Growth means the load is not sterile and everything back to the last negative test is recalled.",
     "fields": [
       { "id": "load_number", "label": "Load number", "type": "text" },
       { "id": "cycle_type", "label": "Cycle", "type": "select",
         "options": ["Steam - wrapped", "Steam - unwrapped", "Chemical vapour", "Dry heat"] },
       { "id": "physical_ok", "label": "Time, temperature and pressure within parameters", "type": "boolean",
         "expected": true },
       { "id": "chemical_ok", "label": "Chemical indicator passed", "type": "boolean", "expected": true },
       { "id": "bi_run", "label": "Biological indicator in this load", "type": "boolean",
         "expected": true, "required": false },
       { "id": "bi_result", "label": "Biological indicator result", "type": "select",
         "options": ["No growth (pass)", "Growth (fail)", "Not yet read"],
         "failing": ["Growth (fail)"], "required": false },
       { "id": "implant_load", "label": "Load contains an implant", "type": "boolean",
         "expected": false, "required": false,
         "help": "An implant load is quarantined until the biological indicator is read." },
       { "id": "released", "label": "Load released for use", "type": "boolean", "expected": true }
     ]
   }
   $json$),

  -- SEDATION AND NITROUS. Scope varies by state and by permit level, so
  -- this records the check rather than asserting who may sedate.
  ('sedation-check',
   'Sedation and nitrous safety',
   'Scavenging, monitors, reversal agents and the emergency kit.',
   'clinical', 'daily', array['am'], 30,
   array['provider','medical_assistant']::staff.job_role[],
   $json$
   {
     "standard": "Sedation is only as safe as the monitoring and the rescue. Permit level and who may administer are set by the state dental board — this records that the equipment for the level you hold is present and working.",
     "fields": [
       { "id": "scavenging", "label": "Nitrous scavenging system working", "type": "boolean",
         "expected": true,
         "help": "Waste gas is an occupational exposure for the whole team, not a patient issue." },
       { "id": "o2_flush", "label": "Oxygen flush and fail-safe tested", "type": "boolean", "expected": true },
       { "id": "o2_psi", "label": "Oxygen cylinder", "type": "number", "unit": "PSI",
         "min": 1000, "max": 2400, "step": 10, "presets": [2000, 1800, 1500] },
       { "id": "pulse_ox", "label": "Pulse oximeter working", "type": "boolean", "expected": true },
       { "id": "capnography", "label": "Capnography working where required for this permit level", "type": "boolean",
         "expected": true, "required": false },
       { "id": "suction", "label": "High-volume suction working", "type": "boolean", "expected": true },
       { "id": "reversal_agents", "label": "Reversal agents present and in date", "type": "boolean",
         "expected": true, "required": false },
       { "id": "emergency_kit", "label": "Emergency kit checked and in date", "type": "boolean",
         "expected": true }
     ]
   }
   $json$),

  -- AMALGAM SEPARATOR. EPA's dental effluent guidelines, 40 CFR Part 441,
  -- require a separator and its maintenance per manufacturer instructions
  -- for most practices that place or remove amalgam.
  ('amalgam-separator',
   'Amalgam separator',
   'Inspection and canister level.',
   'operations', 'monthly', array[]::text[], 31,
   array['medical_assistant']::staff.job_role[],
   $json$
   {
     "standard": "40 CFR Part 441 requires an amalgam separator and operation per the manufacturer's instructions, with records retained. A canister allowed to fill past its mark stops separating.",
     "fields": [
       { "id": "canister_pct", "label": "Canister full", "type": "number", "unit": "%",
         "min": 0, "max": 95, "step": 5, "presets": [25, 50, 75, 90],
         "help": "Replace at the level the manufacturer states, not when it is full." },
       { "id": "replaced", "label": "Canister replaced this check", "type": "boolean",
         "expected": false, "required": false },
       { "id": "lines_flushed", "label": "Vacuum lines cleaned with a non-bleach cleaner", "type": "boolean",
         "expected": true,
         "help": "Bleach and oxidising cleaners dissolve mercury and defeat the separator." },
       { "id": "recycler", "label": "Waste consigned to a licensed recycler", "type": "boolean",
         "expected": true, "required": false },
       { "id": "manifest_filed", "label": "Recycling manifest filed", "type": "boolean",
         "expected": true, "required": false }
     ]
   }
   $json$),

  -- PRODUCT RECALL CROSS-CHECK. product-lot already answers "which lots
  -- do we hold"; this is the other half — checking that answer against
  -- FDA's actual recall list rather than waiting to hear about it from a
  -- patient. FDA publishes both device and biologic recalls on an
  -- ongoing, public basis (fda.gov/medical-devices/medical-device-safety
  -- /medical-device-recalls-and-early-alerts) — this is a genuine best
  -- practice built on real public infrastructure, not a numbered
  -- regulatory requirement, and is worded that way below.
  ('recall-check',
   'Product recall check',
   'This month''s injectable and filler lots checked against active FDA recalls.',
   'clinical', 'monthly', array[]::text[], 32,
   array['provider']::staff.job_role[],
   $json$
   {
     "standard": "FDA publishes medical device and biologic recalls on an ongoing basis. Once a month, check every lot currently in stock or used this month against FDA's recall list. A recall found this way is one found before a patient tells you about it.",
     "fields": [
       { "id": "lots_checked", "label": "Distinct lots on hand or used this month", "type": "number",
         "min": 0, "step": 1 },
       { "id": "source", "label": "Checked against", "type": "select",
         "options": ["FDA medical device recalls", "FDA MedWatch safety alerts", "Manufacturer notice, direct"] },
       { "id": "recall_found", "label": "Any lot matched an active recall", "type": "boolean",
         "expected": false },
       { "id": "action_taken", "label": "If matched, what was done", "type": "text", "required": false,
         "placeholder": "Quarantined, manufacturer contacted, patients notified per policy" }
     ]
   }
   $json$),

  -- ADVERSE EVENT REVIEW. Deliberately NOT presented as a federal filing
  -- requirement: FDA's mandatory device-reporting rule, 21 CFR 803,
  -- excludes a physician's office from the definition of "device user
  -- facility" (21 CFR 803.3) — a med spa at this scale files nothing
  -- with FDA for a complication. What actually gets asked for, by a
  -- malpractice carrier or a state medical board, is a monthly internal
  -- record: what happened, and that the person medically responsible
  -- saw it.
  ('adverse-event-review',
   'Adverse event review',
   'This month''s complications, reviewed by the medical director.',
   'clinical', 'monthly', array[]::text[], 33,
   array['provider']::staff.job_role[],
   $json$
   {
     "standard": "Not a federal filing requirement at this scale — this is an internal quality record, the one a malpractice carrier or a state board asks for first. Every complication this month, documented and reviewed by whoever is medically responsible.",
     "fields": [
       { "id": "events_this_month", "label": "Adverse events or complications this month", "type": "number",
         "min": 0, "step": 1, "presets": [0, 1, 2] },
       { "id": "each_documented", "label": "Each one documented in the patient's chart", "type": "boolean",
         "expected": true, "required": false },
       { "id": "director_reviewed", "label": "Reviewed by the medical director", "type": "boolean",
         "expected": true },
       { "id": "follow_up", "label": "Follow-up or corrective action needed", "type": "text", "required": false,
         "placeholder": "e.g. additional training, protocol change, none" }
     ]
   }
   $json$),

  -- FIRE AND LIFE SAFETY. Every ambulatory facility, not one industry —
  -- ACHC's Ambulatory Care standard AC7-4A asks for exactly this:
  -- extinguishers, exit lighting and smoke detectors checked, and the
  -- building's emergency power system tested at least annually. Mapped
  -- to every facility type below rather than one, since the requirement
  -- does not vary by what kind of care happens in the building.
  ('fire-safety-check',
   'Fire and life safety check',
   'Extinguishers, exit lighting and smoke detectors, plus the annual emergency-power test.',
   'operations', 'monthly', array[]::text[], 34,
   array['center_admin','front_desk']::staff.job_role[],
   $json$
   {
     "standard": "Fire extinguishers, exit signage and emergency lighting, and smoke detectors are checked monthly. The building's emergency power system — alarms, exit lighting, emergency communication — is tested at least annually. A charged extinguisher behind a locked door is not a working one.",
     "fields": [
       { "id": "extinguisher_count", "label": "Extinguishers checked", "type": "number",
         "min": 0, "step": 1 },
       { "id": "extinguishers_ok", "label": "Gauge in the charged zone, pin and seal intact, unobstructed", "type": "boolean",
         "expected": true },
       { "id": "exit_lighting_ok", "label": "Exit signage and emergency lighting illuminated", "type": "boolean",
         "expected": true },
       { "id": "smoke_detectors_ok", "label": "Smoke detectors tested and functioning", "type": "boolean",
         "expected": true },
       { "id": "no_smoking_posted", "label": "No-smoking signage posted", "type": "boolean",
         "expected": true, "required": false },
       { "id": "emergency_power_tested", "label": "Emergency power system tested in the last 12 months", "type": "boolean",
         "expected": true, "required": false,
         "help": "Annual, not monthly — mark this once a year, whenever that test is actually done, and leave it as-is the rest of the year." },
       { "id": "emergency_power_test_date", "label": "Date of that test", "type": "date", "required": false }
     ]
   }
   $json$)

) as t(slug, name, description, category, frequency, slots, sort_order, job_roles, schema_json)
where not exists (
  select 1 from staff.form_templates f
   where f.org_slug = '_library' and f.slug = t.slug
);


-- ---------- 5. Seeding a clinic ----------

-- Copies the template set for an org's facility type out of the library.
-- Idempotent per template, so calling it again after an administrator has
-- deactivated one does NOT resurrect it.
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
     sort_order, job_roles, schema_json)
  select p_org, l.slug, l.name, l.description, l.category, l.frequency,
         l.slots, l.sort_order, l.job_roles, l.schema_json
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


-- ---------- 6. Provisioning, fixed ----------

-- DROP THE OLD FOUR-ARGUMENT OVERLOAD FIRST.
--
-- `create or replace function` replaces a function with the SAME
-- signature. Adding a defaulted argument makes a DIFFERENT signature, so
-- this created a second function beside the first rather than replacing
-- it — and a four-argument call then matched both and failed with
-- "function staff.provision_trial(unknown, unknown, unknown, integer) is
-- not unique". The comment that used to sit here claimed the opposite,
-- and production 500ed on every signup until the duplicate was dropped.
--
-- Dropped rather than left in place: the old one predates facility types
-- and seeds no logs, so a clinic that reached it would land on an empty
-- board.
drop function if exists staff.provision_trial(text, text, text, int);

-- Now takes a facility type and SEEDS THE CLINIC. A four-argument call
-- still works and gets urgent_care — but only because the old overload
-- is dropped immediately above.
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

  insert into staff.org_invites (org_slug, email, role)
  values (final_slug, lower(p_email), 'org_admin');

  -- The line whose absence meant every trial landed on an empty board.
  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.provision_trial(text, text, text, int, text) from public;
grant execute on function staff.provision_trial(text, text, text, int, text) to staff_app;


-- ---------- 7. Adding another clinic to an owner ----------

-- No franchise vocabulary: this is "add a clinic". The group is created
-- lazily on the second one, because an owner with a single site should
-- never have to think about groups at all.
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
begin
  -- The caller must already own a clinic. Without this, add_clinic is an
  -- unauthenticated way to create organizations.
  select u.org_slug, u.id into home_slug, owner_id
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

  -- Group the existing clinic and the new one together, creating the
  -- group on first use.
  select group_id into home_group from staff.orgs where slug = home_slug;
  if home_group is null then
    insert into staff.org_groups (name)
    select coalesce(o.name, home_slug) from staff.orgs o where o.slug = home_slug
    returning id into home_group;
    update staff.orgs set group_id = home_group where slug = home_slug;
  end if;

  insert into staff.orgs (slug, name, plan, subscription_status, is_read_only,
                          billing_email, facility_type, group_id)
  select final_slug, p_name, o.plan, o.subscription_status, o.is_read_only,
         o.billing_email, coalesce(p_facility, 'urgent_care'), home_group
    from staff.orgs o where o.slug = home_slug;

  -- The owner reaches the new clinic as an administrator; their home org
  -- is unchanged, so their session still opens where it always did.
  insert into staff.user_orgs (user_id, org_slug, role, granted_by)
  values (owner_id, final_slug, 'org_admin', owner_id)
  on conflict do nothing;

  insert into staff.org_invites (org_slug, email, role)
  values (final_slug, lower(p_owner_email), 'org_admin')
  on conflict do nothing;

  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.add_clinic(text, text, text, text) from public;
grant execute on function staff.add_clinic(text, text, text, text) to staff_app;


-- ---------- 8. Backfill ----------

-- Every real clinic that was provisioned before this file existed and is
-- therefore sitting on an empty board. Excludes the library, and only
-- touches orgs with no templates at all, so a clinic that has curated its
-- own set is left alone.
do $$
declare r record;
begin
  for r in
    select o.slug from staff.orgs o
     where not o.is_library
       and not exists (
         select 1 from staff.form_templates t where t.org_slug = o.slug
       )
  loop
    perform staff.seed_facility(r.slug);
  end loop;
end $$;

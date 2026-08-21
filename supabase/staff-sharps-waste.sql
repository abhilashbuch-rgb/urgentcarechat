-- ============================================================
-- REGULATED MEDICAL WASTE — the container, the pickup, the calendar
--
-- THREE PIECES, AND THEY BELONG TO DIFFERENT PEOPLE.
--
-- Sealing a full sharps container is clinical work done on a shift by
-- whoever notices the fill line. Releasing that container to a hauler is
-- a transfer of custody recorded against a tracking document. Filing
-- them as one form would mean one signature covering both, which is the
-- same mistake the front-desk close and the administrator's day sheet
-- were split to avoid: the person who signs should be the person who
-- did the thing.
--
-- So: a routine check for clinical staff, an event record for the
-- administrator, and a recurring obligation carrying the date.
--
-- WHY NOT A CALENDAR WIDGET. staff.obligations already holds a due date,
-- a repeat interval, who completed it and when, and an append-only
-- history — and the alert engine already chases what is overdue in it.
-- A second scheduling mechanism would be a second thing to keep correct.
-- ============================================================

insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots, sort_order, schema_json)
values

-- ---------- Clinical staff: the container itself ----------
-- OSHA does not set a fill percentage; it says containers are replaced
-- routinely and not allowed to overfill. Three-quarters is the line the
-- container manufacturers print and the one staff can actually see, so
-- it is the number here — stated as this clinic's rule rather than as a
-- federal one, because it is.
('_library', 'sharps-containers', 'Sharps containers',
 'Fill level, seals, and the secure storage area.',
 'osha', 'daily', array[]::text[], 370,
$json$
{
  "standard": "29 CFR 1910.1030(d)(4)(iii)(A) — containers shall be closable, puncture resistant, leakproof, and replaced routinely and not be allowed to overfill. The three-quarter line below is this clinic's own rule, not a federal one.",
  "fields": [
    { "id": "containers_checked", "label": "Containers checked", "type": "number",
      "min": 1, "step": 1, "presets": [2, 3, 4, 5, 6] },
    { "id": "any_over_three_quarters", "label": "Any container at or above three-quarters", "type": "boolean",
      "expected": false,
      "help": "Yes means it gets sealed and swapped now, not at the end of the shift." },
    { "id": "sealed_and_replaced", "label": "Full containers sealed and replaced", "type": "select",
      "options": ["None were full", "Yes — sealed and replaced", "No — still to do"],
      "failing": ["No — still to do"] },
    { "id": "mounts_secure", "label": "Wall mounts secure, lids working", "type": "boolean", "expected": true },
    { "id": "storage_secured", "label": "Sealed containers in the locked storage area", "type": "boolean",
      "expected": true,
      "help": "Awaiting pickup, out of public reach." },
    { "id": "awaiting_pickup", "label": "Sealed containers awaiting pickup", "type": "number",
      "min": 0, "step": 1, "required": false,
      "help": "The number here is what the administrator reconciles against the manifest." }
  ]
}
$json$::jsonb),

-- ---------- Administrator: the transfer of custody ----------
-- An event, not a schedule: the hauler arrives when the hauler arrives,
-- and a pickup that shows as due every day until it happens is a red row
-- that teaches people to ignore red rows.
('_library', 'waste-pickup', 'Waste pickup / manifest',
 'One entry per collection, with the tracking document.',
 'operations', 'on_event', array[]::text[], 380,
$json$
{
  "standard": "Regulated medical waste transport is governed by state rules and, for shipping papers, 49 CFR Part 172. Most states require the generator to keep the signed tracking document for a set period — commonly three years. Check your own state's rule and set the retention accordingly.",
  "fields": [
    { "id": "pickup_date", "label": "Date collected", "type": "date" },
    { "id": "hauler", "label": "Hauling company", "type": "text" },
    { "id": "manifest_number", "label": "Manifest / tracking number", "type": "text",
      "help": "The number on the document the driver leaves with you. This is the whole point of the record." },
    { "id": "sharps_containers", "label": "Sharps containers released", "type": "number",
      "min": 0, "step": 1, "presets": [1, 2, 3, 4] },
    { "id": "other_rmw_containers", "label": "Other regulated waste containers released", "type": "number",
      "min": 0, "step": 1, "required": false },
    { "id": "matches_awaiting", "label": "Count matches what was awaiting pickup", "type": "boolean",
      "expected": true,
      "help": "Against the sharps container log. A mismatch means a container is unaccounted for, which is the finding worth catching on the day rather than at audit." },
    { "id": "driver_name", "label": "Driver name on the document", "type": "text", "required": false },
    { "id": "document_filed", "label": "Signed copy filed", "type": "boolean", "expected": true }
  ]
}
$json$::jsonb)

on conflict (org_slug, slug) where slug is not null do update set
  name        = excluded.name,
  description = excluded.description,
  category    = excluded.category,
  frequency   = excluded.frequency,
  sort_order  = excluded.sort_order,
  schema_json = excluded.schema_json;

-- ---------- Who sees which ----------
-- The container check goes to the people on the floor AND to the centre
-- admin, because on a short-staffed afternoon the admin is the person on
-- the floor. The pickup record is the admin's alone: it is a custody
-- transfer signed against a document, and an MA should not be attesting
-- to what a driver took away.
update staff.form_templates
   set job_roles = array['medical_assistant','xray_tech','center_admin']::staff.job_role[]
 where slug = 'sharps-containers';

update staff.form_templates
   set job_roles = array['center_admin']::staff.job_role[]
 where slug = 'waste-pickup';

-- ---------- Everyone generates sharps ----------
insert into staff.facility_templates (facility_type, template_slug)
select f.t, s.slug
  from (values ('urgent_care'),('primary_care'),('med_spa'),
               ('ambulatory_surgery'),('dental')) as f(t)
 cross join (values ('sharps-containers'),('waste-pickup')) as s(slug)
on conflict do nothing;

insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots, sort_order, schema_json, active, job_roles)
select o.slug, t.slug, t.name, t.description, t.category, t.frequency,
       t.slots, t.sort_order, t.schema_json, true, t.job_roles
  from staff.orgs o
  join staff.facility_templates ft
    on ft.facility_type = coalesce(o.facility_type, 'urgent_care')
  join staff.form_templates t
    on t.org_slug = '_library' and t.slug = ft.template_slug
 where not o.is_library and o.active
   and t.slug in ('sharps-containers','waste-pickup')
   and not exists (
         select 1 from staff.form_templates x
          where x.org_slug = o.slug and x.slug = t.slug
       );

-- ---------- The calendar ----------
-- A recurring obligation rather than a new scheduling table. When it is
-- marked done, staff.obligations records who and when and rolls due_on
-- forward by repeat_months, and the alert engine already chases what is
-- overdue there.
--
-- ONE MONTH IS A STARTING GUESS, NOT A RULE. Collection intervals are a
-- contract between the clinic and its hauler; a busy urgent care may be
-- weekly and a small practice quarterly. Seeded monthly, and the owner
-- changes it — repeat_months is an integer on the row.
--
-- Only for clinics that do not already have one, so re-running this does
-- not reset a date somebody has already moved.
insert into staff.obligations
  (org_slug, key, title, detail, category, citation, source,
   due_on, repeat_months, active, job_roles)
select o.slug,
       'rmw-pickup',
       'Regulated medical waste collection',
       'Confirm the hauler is booked, and file the manifest under '
       'Record an event once the collection has happened. The interval '
       'here is a starting guess — set it to whatever your contract says.',
       'osha',
       'State regulated medical waste rules; 49 CFR Part 172 for shipping papers',
       'contract',
       current_date + 30,
       1,
       true,
       array['center_admin']::staff.job_role[]
  from staff.orgs o
 where not o.is_library and o.active
   and not exists (
         select 1 from staff.obligations x
          where x.org_slug = o.slug and x.key = 'rmw-pickup'
       );

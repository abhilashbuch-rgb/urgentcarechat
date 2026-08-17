-- ============================================================
-- THE STANDARD LOG SET
--
-- Run AFTER supabase/staff-logs.sql. Idempotent; safe to re-run.
--
-- Every threshold below comes from a published standard, and each one is
-- named in the form's `standard` line so the person filling it in can see
-- what they are checking against without looking anything up. Where a
-- number depends on the specific clinic — which fridges exist, which
-- assays are run, which drugs are stocked — the options are a starting
-- point an administrator edits, not a fact about this clinic that
-- anybody invented.
--
-- NOT INCLUDED HERE ON PURPOSE: "clinical/financial separation". It is an
-- annual staff acknowledgement, not something anybody measures on a
-- shift, so it belongs in the onboarding packet where it gets a signature
-- against a document version. Putting it here would have produced a
-- checkbox with no signature behind it.
-- ============================================================

insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots, sort_order, schema_json)
values

('afc', 'crash-cart', 'Crash cart & AED',
 'Seal, AED self-test, oxygen pressures, suction.',
 'clinical', 'daily', array['am'], 10,
$json$
{
  "standard": "Seal intact and matching the log. AED self-test green. Both O2 cylinders above 1000 PSI. Suction pulls.",
  "fields": [
    { "id": "seal_number", "label": "Breakaway seal number", "type": "text",
      "placeholder": "e.g. 004821",
      "help": "Read it off the tag. If it does not match yesterday's, the cart was opened." },
    { "id": "seal_intact", "label": "Seal intact", "type": "boolean", "expected": true },
    { "id": "aed_status", "label": "AED self-test indicator", "type": "select",
      "options": ["Green check", "Red / flashing", "Audible alarm", "No indication"],
      "failing": ["Red / flashing", "Audible alarm", "No indication"] },
    { "id": "aed_pads_expiry", "label": "Electrode pad expiry", "type": "date" },
    { "id": "o2_primary_psi", "label": "Primary O2 cylinder", "type": "number",
      "unit": "PSI", "min": 1000, "max": 2400, "step": 10 },
    { "id": "o2_backup_psi", "label": "Backup O2 cylinder", "type": "number",
      "unit": "PSI", "min": 1000, "max": 2400, "step": 10 },
    { "id": "suction_ok", "label": "Suction unit pulls", "type": "boolean", "expected": true }
  ]
}
$json$::jsonb),

('afc', 'temp-fridge', 'Refrigerator temperatures',
 'Current, 24-hour minimum and maximum for each unit.',
 'clinical', 'per_shift', array['am','pm'], 20,
$json$
{
  "standard": "Vaccine storage 36-46 °F (2-8 °C). Any excursion means quarantine the stock and call the manufacturer before discarding anything.",
  "fields": [
    { "id": "unit", "label": "Unit", "type": "select",
      "options": ["Vaccine fridge", "Medication fridge", "Lab reagent fridge"] },
    { "id": "current_f", "label": "Current", "type": "number",
      "unit": "°F", "min": 36, "max": 46, "step": 0.1 },
    { "id": "min_24h_f", "label": "24-hour minimum", "type": "number",
      "unit": "°F", "min": 36, "max": 46, "step": 0.1 },
    { "id": "max_24h_f", "label": "24-hour maximum", "type": "number",
      "unit": "°F", "min": 36, "max": 46, "step": 0.1 },
    { "id": "memory_reset", "label": "Min/max memory reset after reading", "type": "boolean",
      "expected": true,
      "help": "Reset it, or tomorrow's numbers are today's all over again." }
  ]
}
$json$::jsonb),

('afc', 'narcotics-count', 'Controlled substance count',
 'Physical count at shift change, with a witness.',
 'clinical', 'per_shift', array['am','pm'], 30,
$json$
{
  "standard": "Two people count. Both sign. A discrepancy is reported before anyone leaves the building — it is never resolved by recounting until it matches.",
  "fields": [
    { "id": "safe_locked", "label": "Safe was locked on arrival", "type": "boolean", "expected": true },
    { "id": "count_a", "label": "Lorazepam 2 mg/mL — vials", "type": "number", "min": 0, "step": 1 },
    { "id": "count_b", "label": "Diazepam 5 mg/mL — vials", "type": "number", "min": 0, "step": 1 },
    { "id": "count_c", "label": "Ketorolac 30 mg/mL — vials", "type": "number", "min": 0, "step": 1,
      "required": false },
    { "id": "matches_record", "label": "Physical count matches the running record", "type": "boolean",
      "expected": true },
    { "id": "wastage", "label": "Wastage this shift", "type": "text", "required": false,
      "placeholder": "drug, amount, witness — or leave blank" },
    { "id": "witness_email", "label": "Witness (work email)", "type": "text",
      "placeholder": "name@…",
      "help": "The second person who physically counted with you." }
  ]
}
$json$::jsonb),

('afc', 'eyewash-autoclave', 'Eyewash & autoclave',
 'Weekly eyewash flush and the autoclave biological indicator.',
 'operations', 'weekly', array[]::text[], 40,
$json$
{
  "standard": "ANSI/ISEA Z358.1 — activate weekly and run long enough to clear the line. Autoclave spore test read at 24-48 h; growth means the load is not sterile.",
  "fields": [
    { "id": "flush_minutes", "label": "Eyewash flush duration", "type": "number",
      "unit": "min", "min": 3, "step": 0.5,
      "help": "Run it until the water is clear and tepid — at least three minutes." },
    { "id": "water_clear", "label": "Water ran clear", "type": "boolean", "expected": true },
    { "id": "caps_clean", "label": "Nozzle caps clean and in place", "type": "boolean", "expected": true },
    { "id": "bi_lot", "label": "Spore test lot number", "type": "text", "required": false },
    { "id": "bi_result", "label": "Biological indicator result", "type": "select",
      "options": ["No growth (pass)", "Growth (fail)", "Not yet read"],
      "failing": ["Growth (fail)"], "required": false },
    { "id": "bi_control", "label": "Positive control grew", "type": "boolean", "expected": true,
      "required": false,
      "help": "A control that did not grow invalidates the test — the run has to be repeated." }
  ]
}
$json$::jsonb),

('afc', 'poct-qc', 'Point-of-care testing QC',
 'Controls for CLIA-waived assays, per new lot or shipment.',
 'clinical', 'monthly', array[]::text[], 50,
$json$
{
  "standard": "Run positive and negative controls with each new lot, each new shipment, each new operator, and whenever results look wrong. An invalid control means the assay is not reportable.",
  "fields": [
    { "id": "assay", "label": "Assay", "type": "select",
      "options": ["Strep A", "Influenza A/B", "COVID-19 antigen", "RSV", "Urinalysis", "Urine hCG", "Mono"] },
    { "id": "lot", "label": "Kit lot number", "type": "text" },
    { "id": "expiry", "label": "Kit expiry", "type": "date" },
    { "id": "reason", "label": "Reason for this run", "type": "select",
      "options": ["New lot", "New shipment", "New operator", "Scheduled", "Suspect result"] },
    { "id": "positive_control", "label": "Positive control", "type": "select",
      "options": ["Pass", "Invalid"], "failing": ["Invalid"] },
    { "id": "negative_control", "label": "Negative control", "type": "select",
      "options": ["Pass", "Invalid"], "failing": ["Invalid"] }
  ]
}
$json$::jsonb),

('afc', 'radiation-apron', 'Lead apron inspection',
 'Annual integrity check of each apron and thyroid shield.',
 'clinical', 'quarterly', array[]::text[], 60,
$json$
{
  "standard": "Inspect visually and by hand for cracks, tears, and separation, especially along seams and fold lines. A folded apron cracks where it folds — hang them.",
  "fields": [
    { "id": "item_id", "label": "Apron / shield identifier", "type": "text",
      "placeholder": "e.g. Apron 2 — X-ray room" },
    { "id": "item_type", "label": "Type", "type": "select",
      "options": ["Full apron", "Vest and skirt", "Thyroid shield", "Gonadal shield"] },
    { "id": "visual_ok", "label": "No visible cracks, tears, or seam separation", "type": "boolean",
      "expected": true },
    { "id": "tactile_ok", "label": "No defects felt along seams and fold lines", "type": "boolean",
      "expected": true },
    { "id": "fluoro_done", "label": "Fluoroscopic or radiographic check performed", "type": "boolean",
      "expected": true, "required": false },
    { "id": "disposition", "label": "Disposition", "type": "select",
      "options": ["In service", "Removed from service"], "failing": ["Removed from service"] }
  ]
}
$json$::jsonb),

('afc', 'qi-minutes', 'Quality improvement review',
 'Quarterly chart audit, over-read concordance, incidents, grievances.',
 'operations', 'quarterly', array[]::text[], 70,
$json$
{
  "standard": "Review the quarter's numbers together and record what changes as a result. A review with no action recorded is a meeting, not quality improvement.",
  "fields": [
    { "id": "charts_audited", "label": "Charts audited", "type": "number", "min": 0, "step": 1 },
    { "id": "concordance_pct", "label": "Radiology over-read concordance", "type": "number",
      "unit": "%", "min": 90, "max": 100, "step": 0.1,
      "help": "Discordant over-reads below the threshold trigger provider-level review." },
    { "id": "incidents", "label": "Incident reports this quarter", "type": "number", "min": 0, "step": 1 },
    { "id": "grievances", "label": "Patient grievances", "type": "number", "min": 0, "step": 1 },
    { "id": "attendees", "label": "Attendees", "type": "text" },
    { "id": "actions", "label": "Actions agreed", "type": "text" }
  ]
}
$json$::jsonb)

-- The arbiter index is partial (slug is not null), so the predicate has
-- to be repeated here for Postgres to recognise it.
on conflict (org_slug, slug) where slug is not null do nothing;

-- The eighth item from the standard set, in the place it belongs: an
-- annual acknowledgement with a signature against a document version,
-- rather than a checkbox on a log.
insert into staff.policy_docs
  (org_slug, key, version, title, category, summary, body_md, attestation,
   applies_to, renew_months, sort_order, published_at)
values
('afc', 'clinical-financial-separation', 1,
 'Separation of clinical judgement from billing', 'clinical',
 'Clinical decisions are made on clinical grounds, and nobody is asked to make them on any other.',
$md$
## The rule

What a patient needs is decided on clinical grounds. Not on their coverage,
not on what they can pay today, and not on what a service is worth to the
clinic.

## In practice

- Clinical staff do not quote prices, negotiate balances, or discuss what a
  visit will cost. Send those questions to the front desk — it protects the
  patient and it protects you.
- Front desk staff do not advise on what care someone needs, add a service to
  a visit, or discourage one. Collecting a copay is a separate act from
  deciding what is medically necessary, and the two conversations do not
  happen at once.
- A patient's ability to pay never changes the screening or stabilizing care
  they are offered.
- Nobody's compensation is tied to ordering more tests, more imaging, or more
  visits, and no one may ask you to order something for that reason.

## If you are asked anyway

If anyone asks you to change a clinical decision for a financial reason, or a
billing decision for a clinical one, say no and report it. Report it even if
the person asking outranks you — especially then. You will not be penalized
for a good-faith report, and this is exactly the situation the incident
reporting policy exists to catch.
$md$,
 'I understand that clinical decisions are made on clinical grounds alone, that I will not let a patient''s ability to pay change the care they are offered, and that I will report any request to do otherwise.',
 null, 12, 70, now())
on conflict (org_slug, key, version) do nothing;

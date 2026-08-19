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

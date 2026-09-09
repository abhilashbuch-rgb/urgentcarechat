-- ============================================================
-- AI-ASSISTED READING PROVENANCE
--
-- Run AFTER supabase/staff-log-photos.sql. Idempotent.
--
-- WHAT THIS RECORDS. When a number in a shift log was filled in by a
-- staffer confirming (or overriding) a vision-model read of a photo,
-- rather than typed straight from the keyboard, this is where that
-- fact is written down. It is provenance and QA data — "how did this
-- number get here" — not the compliance record itself. The number a
-- surveyor reads is, and always was, staff.form_responses.answers_json;
-- this table exists beside it, never instead of it.
--
-- DELIBERATELY NOT ON staff.form_responses, AND NOT PART OF THE HASH
-- CHAIN. staff.chain_form_response() (see staff-immutability.sql)
-- digests a fixed, explicitly-ordered list of columns at insert time;
-- staff.verify_log_chain() recomputes that same fixed formula later to
-- check integrity. Adding a column to that formula would make every
-- historical row's stored hash disagree with a freshly recomputed one
-- under the new formula — verify_log_chain() would report every
-- existing log as tampered, which it was not. The answer value itself
-- is already inside answers_json, which is already in the chain, so
-- putting HOW it was entered inside the tamper-evident record buys
-- nothing and risks that. A separate, ordinary append-only table is
-- the safer place for it.
--
-- SEE ALSO staff-log-photos.sql for why a vision API is being called
-- here at all, given that migration's note about declining that trade
-- for staff avatars — this table doesn't touch that question, it's
-- purely bookkeeping for what capture path a value took.
-- ============================================================

create table if not exists staff.log_field_captures (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  response_id uuid not null references staff.form_responses(id) on delete cascade,

  -- Which field on that response this is about, e.g. "current_f".
  field_id text not null,

  capture_method text not null check (capture_method in ('typed', 'photo_confirmed')),

  -- What the vision model proposed, and how confident it said it was.
  -- Null when capture_method is 'typed' — there was no read to record.
  ai_value numeric,
  ai_confidence text check (ai_confidence in ('high', 'low')),
  model text,

  -- What the person actually confirmed into the field. For
  -- 'photo_confirmed' this usually equals ai_value; it can differ if
  -- they edited the suggestion before submitting, which is exactly the
  -- case this table exists to be honest about.
  confirmed_value numeric,

  created_by uuid references staff.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists staff_log_field_captures_response
  on staff.log_field_captures (response_id);

create index if not exists staff_log_field_captures_org
  on staff.log_field_captures (org_slug, created_at desc);

alter table staff.log_field_captures enable row level security;
alter table staff.log_field_captures force row level security;

drop policy if exists staff_org_isolation on staff.log_field_captures;
create policy staff_org_isolation on staff.log_field_captures
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

-- INSERT ONLY, same posture as staff.log_photos: this is a record of
-- what happened, not a field somebody edits later.
grant select, insert on staff.log_field_captures to staff_app;
revoke update, delete on staff.log_field_captures from staff_app;

-- ============================================================
-- ROLLOUT: turn the read-from-photo control on for temp-fridge's
-- current field.
--
-- The seed file (staff-logs-seed.sql) sets aiRead on this field for
-- brand-new orgs going forward, but a seed-file edit only affects orgs
-- provisioned after this ships. This backfills every org that already
-- has the template, so existing clinics get the control too. Same
-- patch-by-field-id idiom as staff-log-presets.sql — by id, not array
-- index, so it doesn't care what order the fields happen to be in and
-- is safe to run again.
-- ============================================================

update staff.form_templates t
set schema_json = jsonb_set(
  t.schema_json,
  array['fields', (p.ord - 1)::text],
  p.value || '{"aiRead": true}'::jsonb
)
from staff.form_templates f
cross join lateral jsonb_array_elements(f.schema_json->'fields') with ordinality as p(value, ord)
where f.id = t.id
  and f.slug = 'temp-fridge'
  and p.value->>'id' = 'current_f';

-- ============================================================
-- FDA RECALLS, MATCHED AGAINST WHAT A CLINIC ACTUALLY STOCKS
--
-- Run AFTER supabase/staff-inventory.sql, which this references.
--
-- One row per (org, item, recall) that openFDA currently lists as
-- Ongoing and whose text matched a real, named item this clinic
-- stocks — see lib/staff/recalls.ts for the matching logic and why it
-- is deliberately narrow (inventory item names only, never the
-- generic equipment-calibration categories).
--
-- A CURRENT-STATE TABLE, NOT AN AUDIT LOG. Unlike staff.shift_misses
-- (append-only, never deleted — a record of who was told what), this
-- one IS meant to be updated and deleted: when FDA lifts a recall, the
-- daily cron (lib/staff/recalls.ts's matchRecallsForOrg) removes the
-- row the same run, because a stale "this is recalled" notice is
-- actively wrong, not just old.
--
-- Shown to everyone who sees the staff home board — see
-- app/staff/page.tsx — not admin-only. A recall on a vaccine lot
-- sitting in the fridge is exactly the kind of thing whoever is about
-- to give that vaccine needs to see, not only whoever runs the
-- clinic.
-- ============================================================

create table if not exists staff.recall_alerts (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  item_id uuid not null references staff.inventory_items(id) on delete cascade,
  source text not null check (source in ('fda_drug', 'fda_device')),
  recall_number text not null,
  -- FDA's own severity classes: Class I (serious harm/death), Class II
  -- (temporary/reversible harm), Class III (unlikely to cause harm).
  -- Not constrained to those three exact strings — openFDA's field is
  -- free text and this table should not fail an insert over a value
  -- FDA itself sends unexpectedly.
  classification text,
  status text not null,
  product_description text not null,
  reason_for_recall text,
  recalling_firm text,
  report_date date,
  detail_url text,
  matched_at timestamptz not null default now(),
  unique (org_slug, item_id, recall_number)
);

alter table staff.recall_alerts enable row level security;
alter table staff.recall_alerts force row level security;

drop policy if exists staff_org_isolation on staff.recall_alerts;
create policy staff_org_isolation on staff.recall_alerts
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

-- Update and delete, unlike staff.shift_misses — see the header above.
grant select, insert, update, delete on staff.recall_alerts to staff_app;

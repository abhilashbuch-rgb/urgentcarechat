-- ============================================================
-- INVENTORY — an add-on, not included
--
-- Run AFTER supabase/staff-schema.sql and staff-security.sql. Idempotent.
--
-- WHAT THIS IS, AND WHY IT IS NOT ONE MORE staff.form_templates ROW.
-- Every other recurring check in this module is a fixed set of fields
-- filled in once per occurrence — a fridge temperature, a narcotics
-- count of three named drugs. Inventory is a different shape: an
-- open-ended, clinic-edited CATALOG of items, each counted repeatedly
-- over time, each carrying its own quantity, its own expiration (or
-- none), and its own photo. staff.form_templates' schema_json is a
-- fixed field list per template; it has no notion of "one row per item
-- in a catalog the clinic maintains itself." Retrofitting that into the
-- shared form renderer every existing check depends on would risk the
-- checks already running in production for every real clinic today, to
-- build a feature currently off for all of them. A small, separate pair
-- of tables costs less and touches nothing that already works.
--
-- WHO DOES IT: runsClinic() IN APPLICATION TERMS, SAME AS CLINIC LOGS.
-- The centre administrator is the person who knows what is actually on
-- the shelf, and their account role is very often plain "staff". Gating
-- this on account role alone would put the catalog and the count in the
-- hands of the one person who is not in the stock room. See
-- lib/staff/roles.ts's runsClinic() and the identical reasoning on
-- app/staff/settings/logs/page.tsx.
--
-- AN ADD-ON, MANUALLY FLAGGED FOR NOW. No Stripe price or checkout yet
-- — this is one boolean an operator flips per clinic, same as how the
-- billing_specialist seat add-on started in
-- staff-billing-specialist-addon.sql before it needed real billing.
-- Everything below stays inert, including the nav link, until the flag
-- is on.
--
-- APPEND-ONLY COUNTS, SAME REASONING AS staff.form_responses. A count
-- that turns out to be wrong is corrected by filing a new one with
-- supersedes_id and correction_reason set, never by editing history —
-- "how many vials were on the shelf, and did anyone go back and change
-- that later" has to keep one answer.
-- ============================================================

-- ---------- the add-on flag ----------

alter table staff.orgs
  add column if not exists inventory_addon_enabled boolean not null default false;

comment on column staff.orgs.inventory_addon_enabled is
  'Manually flagged per clinic for now — no Stripe price yet. Gates the /staff/inventory page, its API routes, and the nav link. See staff-inventory.sql.';

-- ---------- the catalog ----------

create table if not exists staff.inventory_items (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  name text not null,
  category text,
  -- "vials", "boxes", "each" — printed next to the quantity, never
  -- validated against a fixed list. A clinic's stock room has its own
  -- units and this is not the place to argue with it.
  unit text not null default 'each',

  -- Nullable on purpose. Not every item is worth a reorder alert, and a
  -- required threshold would force a made-up number onto everything
  -- that doesn't have one.
  reorder_threshold numeric,

  -- Deactivated, never deleted — same reasoning as staff.obligations:
  -- an item a clinic stopped stocking still owned every count already
  -- filed against it, and a foreign key with no row behind it would
  -- orphan that history.
  active boolean not null default true,

  created_at timestamptz not null default now(),
  created_by uuid references staff.users(id) on delete set null
);

create index if not exists staff_inventory_items_org
  on staff.inventory_items (org_slug) where active;

-- ---------- the counts ----------

create table if not exists staff.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  item_id uuid not null references staff.inventory_items(id) on delete cascade,

  quantity numeric not null check (quantity >= 0),
  -- Null means this item does not expire (a piece of equipment, a
  -- reusable seal) — distinct from "expiration not entered", which this
  -- schema does not try to distinguish. The UI asks for it whenever the
  -- item's category suggests it matters; nothing here forces that.
  expiration_date date,
  note text,

  counted_by uuid references staff.users(id) on delete set null,
  counted_at timestamptz not null default now(),

  -- A correction inserts a new row pointing at the one it replaces,
  -- same shape as staff.form_responses' supersedes_id/correction_reason.
  supersedes_id uuid references staff.inventory_counts(id),
  correction_reason text,

  created_at timestamptz not null default now()
);

do $$ begin
  alter table staff.inventory_counts
    add constraint staff_inventory_counts_correction_reason
    check (
      supersedes_id is null
      or (correction_reason is not null and length(btrim(correction_reason)) >= 20)
    );
exception when duplicate_object then null; end $$;

create index if not exists staff_inventory_counts_item
  on staff.inventory_counts (item_id, counted_at desc);
create index if not exists staff_inventory_counts_org_time
  on staff.inventory_counts (org_slug, counted_at desc);

-- Append-only. Same trigger every other ledger in this module already
-- uses — see supabase/staff-schema.sql's "refuse mutation" section.
drop trigger if exists staff_inventory_counts_append_only on staff.inventory_counts;
create trigger staff_inventory_counts_append_only
  before update or delete on staff.inventory_counts
  for each row execute function staff.refuse_mutation();

revoke update, delete on staff.inventory_counts from staff_app;

-- ---------- photos ----------

-- Same shape as staff.log_photos: a separate table, uploaded AFTER the
-- count is filed, never with it. A failed photo upload must not cost
-- the count.
create table if not exists staff.inventory_photos (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  count_id uuid not null references staff.inventory_counts(id) on delete cascade,

  file_path text not null,
  file_type text not null,
  file_bytes integer not null,
  caption text,

  taken_by uuid references staff.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists staff_inventory_photos_count
  on staff.inventory_photos (count_id);

-- ---------- current state, derived rather than stored ----------

-- The latest non-superseded count per item — same "latest" shape
-- staff.todays_logs already uses (a lateral pick of the newest row with
-- nothing pointing at it as its supersedes_id), just without the slot
-- machinery a fixed-field template needs.
create or replace view staff.inventory_current
with (security_invoker = true) as
select i.org_slug, i.id as item_id, i.name, i.category, i.unit,
       i.reorder_threshold, i.active,
       c.id as count_id, c.quantity, c.expiration_date, c.note,
       c.counted_at, c.counted_by,
       u.legal_name as counted_by_name
  from staff.inventory_items i
  left join lateral (
    select c2.*
      from staff.inventory_counts c2
     where c2.item_id = i.id
       and not exists (
             select 1 from staff.inventory_counts newer
              where newer.supersedes_id = c2.id
           )
     order by c2.counted_at desc
     limit 1
  ) c on true
  left join staff.users u on u.id = c.counted_by;

grant select on staff.inventory_current to staff_app;

-- Whether this week's round is done: every active item has a current
-- count filed since the week started, in the clinic's own timezone.
-- Derived on read, same reasoning as staff.obligations' overdue flag —
-- a nightly job that marks a round "done" is a job that can fail
-- silently, and the failure looks exactly like nothing being due.
create or replace view staff.inventory_week_status
with (security_invoker = true) as
select o.slug as org_slug,
       date_trunc('week', now() at time zone o.timezone)::date as week_starts_on,
       count(i.id) as total_active,
       count(i.id) filter (
         where ic.counted_at >= date_trunc('week', now() at time zone o.timezone)
       ) as counted_this_week
  from staff.orgs o
  left join staff.inventory_items i on i.org_slug = o.slug and i.active
  left join staff.inventory_current ic on ic.item_id = i.id
 where o.inventory_addon_enabled
 group by o.slug, o.timezone;

grant select on staff.inventory_week_status to staff_app;

-- ============================================================
-- ROW-LEVEL SECURITY — same shape as every other org-scoped table.
-- ============================================================

alter table staff.inventory_items enable row level security;
alter table staff.inventory_items force row level security;
alter table staff.inventory_counts enable row level security;
alter table staff.inventory_counts force row level security;
alter table staff.inventory_photos enable row level security;
alter table staff.inventory_photos force row level security;

do $$
declare t text;
begin
  foreach t in array array['inventory_items', 'inventory_counts', 'inventory_photos'] loop
    execute format('drop policy if exists staff_org_isolation on staff.%I', t);
    execute format($f$
      create policy staff_org_isolation on staff.%I
        for all
        using (staff.is_super_admin() or org_slug = staff.current_org())
        with check (staff.is_super_admin() or org_slug = staff.current_org())
    $f$, t);
  end loop;
end $$;

-- Items are edited (renamed, rethresholded, deactivated) but never
-- deleted from the app — see the comment on the active column above.
grant select, insert, update on staff.inventory_items to staff_app;
-- Counts are insert-only from the app; corrections are a new row.
grant select, insert on staff.inventory_counts to staff_app;
grant select, insert on staff.inventory_photos to staff_app;

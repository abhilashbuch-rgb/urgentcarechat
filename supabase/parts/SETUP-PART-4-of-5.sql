-- ============================================================
-- medicin. STAFF MODULE — SETUP PART 4 OF 5
--
-- RUN THE PARTS IN ORDER, 1 through 5, each as its own paste.
-- Wait for one to report success before starting the next; a later part
-- refers to tables an earlier one creates.
--
-- Every part is idempotent on its own, so re-running one is safe and a
-- part that half-succeeded can simply be run again.
--
-- Migrations in this part:
--   staff-reports
--   staff-facility
--   staff-audio-audit
--   staff-invites
--   staff-signup-guard
--   staff-immutability
--   staff-amend
--   staff-statutory-logs
--   staff-credential-matrix
--   staff-sharps-waste
--   staff-provision-seed
--   staff-org-settings
-- ============================================================

-- ========== staff-reports.sql ==========

-- ============================================================
-- SCHEDULED LOG REPORTS
--
-- Run AFTER supabase/staff-alerts.sql and staff-surveyor.sql. Idempotent.
--
-- The owner wants the week's logs to arrive without asking for them, at a
-- cadence they choose, with every timestamp and every name on it. Daily,
-- weekly, monthly, or all three at once for somebody who wants the daily
-- AND the roll-up.
--
-- ---------------------------------------------------------------
-- A LINK, NOT AN ATTACHMENT. This was the design question.
-- ---------------------------------------------------------------
-- These reports name people. Who filed what, at what minute, from how far
-- away, and what they wrote in a corrective action. An emailed PDF of
-- that lives in an inbox permanently, syncs to every phone on the
-- account, gets forwarded, and sits in backups nobody controls. It cannot
-- be recalled when an administrator leaves or a center changes hands.
--
-- A tokened link can be expired and revoked, and it records whether
-- anybody actually opened it — which an attachment never can. It also
-- reuses the surveyor-token design in staff-surveyor.sql, which is
-- already proven here: the token is never stored, only its SHA-256, so a
-- database dump yields no working links.
--
-- THE FRICTION OBJECTION IS REAL, so the email carries the headline
-- numbers in its body — filed, missed, out of range, off site. An owner
-- whose week was clean never has to click anything. The link is for the
-- week that was not.
--
-- ---------------------------------------------------------------
-- THE PDF IS NOT STORED. It is rendered when the link is opened.
-- ---------------------------------------------------------------
-- Storing generated files would mean a storage bucket, a cleanup job for
-- expired ones, and a permanent question about whether the stored copy
-- still matches the record. Rendering on open needs none of that: the row
-- below holds only the PERIOD, and the report is built from the live
-- tables each time. The binder renderer already does 90 days in ~200ms,
-- so a week is not worth caching.
--
-- It also means a corrected record shows corrected. A stored PDF from
-- Monday would keep asserting Monday's version of events after an
-- amendment, which is the opposite of what a compliance record is for.
-- ============================================================

-- ---------- 1. Who gets what, how often ----------

-- ONE ROW PER (org, email, cadence), NOT one row per person with three
-- booleans. Each cadence has its own last_sent_at and its own next due
-- date, and somebody who wants daily and monthly genuinely wants two
-- independent schedules — collapsing them into one row means one
-- last_sent_at doing two jobs and a daily send suppressing the monthly.
create table if not exists staff.report_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  -- An address, not a user id. The owner who wants the weekly report may
  -- not have a staff account at all, and requiring one to receive a PDF
  -- would mean provisioning logins for accountants and franchise
  -- managers who should never see the inside of the app.
  email text not null,

  -- A name for the report's greeting and for the audit trail.
  label text,

  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),

  -- Local hour to send, 0-23, in the ORG's timezone. Default 7 so the
  -- daily lands before the clinic opens and the weekly lands with Monday
  -- morning coffee.
  send_hour integer not null default 7 check (send_hour between 0 and 23),

  -- Weekly only: 0 = Sunday .. 6 = Saturday, matching Postgres dow.
  -- Default 1 (Monday) so a weekly report covers a finished week.
  send_dow integer check (send_dow between 0 and 6),

  -- Monthly only: day of month. Capped at 28 so no cadence silently skips
  -- February — a subscription set to the 31st would fire seven times a
  -- year and the owner would never know which months it missed.
  send_dom integer check (send_dom between 1 and 28),

  active boolean not null default true,

  -- The last period this subscription was sent for. Compared against the
  -- period that is currently due, which is what makes the sweep
  -- idempotent: a cron that fires twice, or a retry after a timeout,
  -- cannot send the same report twice.
  last_period_end date,
  last_sent_at timestamptz,

  created_by uuid references staff.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- One subscription per address per cadence per org. Re-subscribing is
  -- an update, not a second email arriving twice every morning.
  unique (org_slug, email, cadence)
);

-- The shape each cadence actually needs, enforced rather than assumed. A
-- weekly row with no day-of-week has no defined send time, and a monthly
-- row carrying a day-of-week is a row somebody edited from weekly and
-- half-finished.
do $$ begin
  alter table staff.report_subscriptions add constraint staff_report_sub_shape
    check (
      (cadence = 'daily'   and send_dow is null     and send_dom is null)
      or (cadence = 'weekly'  and send_dow is not null and send_dom is null)
      or (cadence = 'monthly' and send_dow is null     and send_dom is not null)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table staff.report_subscriptions add constraint staff_report_sub_email
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$');
exception when duplicate_object then null; end $$;

create index if not exists staff_report_subs_due
  on staff.report_subscriptions (org_slug, cadence) where active;


-- ---------- 2. What was sent, and was it opened ----------

create table if not exists staff.report_runs (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  subscription_id uuid references staff.report_subscriptions(id) on delete set null,

  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),

  -- The window the report covers, inclusive. Stored rather than derived
  -- so a report opened in a year still renders the period it was sent
  -- for, not a period recomputed from today.
  period_start date not null,
  period_end   date not null,

  -- SHA-256 of the link token, hex. Never the token itself.
  token_hash text not null,
  expires_at timestamptz not null,

  sent_to text not null,
  sent_at timestamptz,
  -- Null until delivery is attempted; set when the provider accepts it.
  send_error text,

  -- Was it read. Answers "does the owner actually look at these" a year
  -- later, which is the question that decides whether this feature earns
  -- its place.
  viewed_count integer not null default 0,
  last_viewed_at timestamptz,

  revoked_at timestamptz,

  created_at timestamptz not null default now(),

  constraint staff_report_period check (period_end >= period_start)
);

do $$ begin
  alter table staff.report_runs add constraint staff_report_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null; end $$;

-- A window is only ever sent once per subscription. The unique index is
-- what makes that true regardless of how many times a cron retries.
create unique index if not exists staff_report_runs_once
  on staff.report_runs (subscription_id, period_end)
  where subscription_id is not null;

create index if not exists staff_report_runs_token
  on staff.report_runs (token_hash);

create index if not exists staff_report_runs_org
  on staff.report_runs (org_slug, created_at desc);


-- ---------- 3. Which period is due right now ----------

-- Returns the period a cadence should cover if it is due at this moment
-- in the org's timezone, or no row if it is not due.
--
-- COMPLETED PERIODS ONLY. A daily report sent at 07:00 covers YESTERDAY,
-- not the morning it is sent in. A weekly one covers the week that ended,
-- not the one in progress. Sending a partial period would produce a
-- report whose "3 logs filed" means nothing, and an owner who learns the
-- numbers are partial stops reading them.
--
-- STABLE, not immutable: it reads the org's timezone.
create or replace function staff.report_period_due(
  p_org text, p_cadence text, p_send_hour integer,
  p_send_dow integer, p_send_dom integer, p_at timestamptz default now()
) returns table (period_start date, period_end date)
language plpgsql stable
as $$
declare
  tz    text;
  local timestamp;
begin
  select timezone into tz from staff.orgs where slug = p_org;
  if tz is null then tz := 'America/New_York'; end if;

  local := p_at at time zone tz;

  -- Not the send hour yet, so nothing is due. Compared on the hour rather
  -- than the minute because the sweep runs hourly; a subscription set to
  -- 07:00 fires on the 07:00 sweep whenever within that hour it lands.
  if extract(hour from local)::integer <> p_send_hour then
    return;
  end if;

  if p_cadence = 'daily' then
    return query select (local::date - 1), (local::date - 1);

  elsif p_cadence = 'weekly' then
    if extract(dow from local)::integer <> p_send_dow then return; end if;
    -- The seven days ending yesterday.
    return query select (local::date - 7), (local::date - 1);

  elsif p_cadence = 'monthly' then
    if extract(day from local)::integer <> p_send_dom then return; end if;
    -- The whole of last calendar month, regardless of which day of this
    -- month the subscription fires on. A "monthly" report covering the
    -- 30 days before the 12th is not a month anybody can reconcile
    -- against anything else.
    return query
      select (date_trunc('month', local::date) - interval '1 month')::date,
             (date_trunc('month', local::date) - interval '1 day')::date;
  end if;
end $$;

revoke all on function staff.report_period_due(text, text, integer, integer, integer, timestamptz) from public;
grant execute on function staff.report_period_due(text, text, integer, integer, integer, timestamptz) to staff_app;


-- ---------- 4. What goes in the report ----------

-- Every filing in a window with everything a reader needs to judge it:
-- who, when to the minute, whether it was in range, what they did about
-- it if not, and where they filed it from.
--
-- security_invoker so it is read under the caller's RLS, and dropped
-- first because CREATE OR REPLACE VIEW can only append columns.
drop view if exists staff.report_log_rows cascade;
create view staff.report_log_rows
with (security_invoker = true)
as
select r.id,
       r.org_slug,
       i.due_date,
       t.name          as form_name,
       t.slug          as form_slug,
       t.category,
       i.slot,
       r.submitted_at,
       u.legal_name    as filed_by,
       r.has_out_of_range,
       r.out_of_range_fields,
       r.corrective_action,
       r.location_status,
       round(r.filed_distance_m)::integer as distance_m,
       r.answers_json
  from staff.form_responses r
  join staff.form_instances i on i.id = r.instance_id
  join staff.form_templates t on t.id = i.template_id
  left join staff.users u     on u.id = r.submitted_by
 order by i.due_date, t.sort_order, i.slot;

grant select on staff.report_log_rows to staff_app;

-- The headline numbers that go in the EMAIL BODY, so a clean period needs
-- no click. Deliberately a handful of integers and nothing else: an owner
-- reading this on a phone is answering one question, which is whether
-- they need to look further.
drop view if exists staff.report_totals cascade;
create view staff.report_totals
with (security_invoker = true)
as
select r.org_slug,
       i.due_date,
       count(*)                                        as filed,
       count(*) filter (where r.has_out_of_range)       as out_of_range,
       count(*) filter (where r.location_status = 'off_site') as off_site,
       count(distinct r.submitted_by)                  as people
  from staff.form_responses r
  join staff.form_instances i on i.id = r.instance_id
 group by r.org_slug, i.due_date;

grant select on staff.report_totals to staff_app;

-- DELETE IS REVOKED, UPDATE IS NOT — and the distinction is the point.
-- A report run must stay updatable because two things are written after
-- the row is created: sent_at once the mail provider accepts it, and the
-- view counter each time the link is opened. Revoking update would have
-- made the view counter silently impossible, which is the same mistake
-- the obligations table made once already (see staff-security.sql: the
-- schema's ALTER DEFAULT PRIVILEGES grants delete on every future table,
-- so each one needs its own explicit revoke).
--
-- Deleting is what must not happen. A delivery history with rows removed
-- is not a delivery history.
grant select, insert, update on staff.report_runs to staff_app;
revoke delete on staff.report_runs from staff_app;
grant select, insert, update, delete on staff.report_subscriptions to staff_app;


-- ========== staff-facility.sql ==========

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

  -- MEDICAL SPA. Emergency readiness still applies — anaphylaxis after
  -- an injectable is the event this industry actually fears.
  ('med_spa', 'crash-cart'),
  ('med_spa', 'temp-fridge'),
  ('med_spa', 'product-lot'),
  ('med_spa', 'laser-safety'),
  ('med_spa', 'eyewash-autoclave'),
  ('med_spa', 'front-desk-open'),
  ('med_spa', 'front-desk-close'),

  -- AMBULATORY SURGERY CENTER.
  ('ambulatory_surgery', 'crash-cart'),
  ('ambulatory_surgery', 'temp-fridge'),
  ('ambulatory_surgery', 'narcotics-count'),
  ('ambulatory_surgery', 'mh-cart'),
  ('ambulatory_surgery', 'sterile-processing'),
  ('ambulatory_surgery', 'eyewash-autoclave'),
  ('ambulatory_surgery', 'poct-qc'),
  ('ambulatory_surgery', 'qi-minutes'),

  -- DENTAL & ORAL SURGERY.
  ('dental', 'crash-cart'),
  ('dental', 'eyewash-autoclave'),
  ('dental', 'sedation-check'),
  ('dental', 'amalgam-separator'),
  ('dental', 'front-desk-open'),
  ('dental', 'front-desk-close')
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


-- ========== staff-audio-audit.sql ==========

-- ============================================================
-- SOUND OFF DURING CLINIC HOURS, AND OFF-SITE FILINGS IN THE DIGEST
--
-- Run AFTER supabase/staff-geofence.sql. Idempotent.
--
-- ---------------------------------------------------------------
-- WHY THE MUTE TOGGLE IS NOT REMOVED
-- ---------------------------------------------------------------
-- The request was to lock audio ON during operating hours and take the
-- toggle away. It is not built that way, for three reasons, and the
-- first two mean the lock would not work even if it were.
--
-- A BROWSER CANNOT BE MADE TO PLAY SOUND. Every autoplay policy requires
-- a genuine user gesture before an AudioContext will resume. A toggle
-- pinned to "on" changes a boolean; it does not produce a noise. The app
-- already unlocks on the first pointer, key or touch event precisely
-- because that is the only thing that works — and a person who never
-- touches the screen hears nothing however the flag is set.
--
-- THE DEVICE WINS ANYWAY. An iPad on the hardware silent switch, or with
-- its volume at zero, is silent. No web application can read either
-- state, let alone override it. "Mandatory audio" would therefore be a
-- claim the software cannot keep on the exact device the claim is aimed
-- at.
--
-- AND SILENCE IS SOMETIMES CORRECT. A workstation in a room with a
-- distressed patient, a provider on the phone to a specialist, a
-- consultation in progress. Software that cannot be silenced for ninety
-- seconds during a difficult conversation is software that gets closed,
-- and a closed app files no logs at all.
--
-- WHAT IS BUILT INSTEAD is the same bet the geofence and the corrective
-- action make, and it is the one that works: the choice stays available,
-- and it is ON THE RECORD. Turning sound off during clinic hours is
-- logged with who and when, appears on the medical director's digest
-- while it is off, and clears itself when sound comes back on. Nobody
-- can quietly run a shift in silence; anybody can silence a room.
-- ============================================================


-- ---------- 1. When sound was turned off ----------

alter table staff.users
  add column if not exists audio_muted_at timestamptz;

-- Set and cleared by the toggle route. Held on the user rather than in a
-- separate event table because the question the digest asks is "who has
-- it off RIGHT NOW", not "how many times has anyone ever". The history
-- is in staff.audit_log, which already records the toggle.
comment on column staff.users.audio_muted_at is
  'When this person last turned shift sound off. Null when sound is on.';

-- Everyone currently silent, with how long for. security_invoker so it
-- reads under the caller''s RLS.
drop view if exists staff.audio_off_now cascade;
create view staff.audio_off_now
with (security_invoker = true)
as
select u.id,
       u.org_slug,
       u.legal_name,
       u.email,
       u.job_role::text as job_role,
       u.audio_muted_at,
       -- Whole minutes. An owner reading "off for 340 minutes" learns
       -- something a timestamp does not tell them at a glance.
       (extract(epoch from (now() - u.audio_muted_at)) / 60)::integer as minutes_off,
       staff.within_operating_hours(u.org_slug) as during_hours
  from staff.users u
 where u.active
   and not u.audio_alerts_enabled
   and u.audio_muted_at is not null;

grant select on staff.audio_off_now to staff_app;


-- ---------- 2. Off-site filings, today ----------

-- The digest reports what happened today; staff.off_site_filings covers
-- all time. This is the window the 9am and 5pm mails actually need, and
-- keeping it separate means neither query grows a date filter the other
-- does not want.
drop view if exists staff.off_site_today cascade;
create view staff.off_site_today
with (security_invoker = true)
as
select r.org_slug,
       t.name as form_name,
       u.legal_name as filed_by,
       r.location_status,
       round(r.filed_distance_m)::integer as distance_m,
       r.location_note,
       r.submitted_at
  from staff.form_responses r
  join staff.form_instances i on i.id = r.instance_id
  join staff.form_templates t on t.id = i.template_id
  left join staff.users u on u.id = r.submitted_by
 where i.due_date = (now() at time zone coalesce(
         (select o.timezone from staff.orgs o where o.slug = r.org_slug),
         'America/New_York'))::date
   and r.location_status in ('off_site', 'denied')
 order by r.submitted_at;

grant select on staff.off_site_today to staff_app;


-- ========== staff-invites.sql ==========

-- ============================================================
-- ADMIN-ISSUED INVITATIONS
--
-- Until this migration, staff.org_invites could only be written by SQL
-- functions and by hand in the SQL editor. The schema said so in a
-- comment: "Add the first invite — insert into staff.org_invites ...".
-- That is fine for the founding owner, whose invite provision_trial
-- writes. It is not a product for the owner who then has to add six
-- medical assistants on a Monday morning.
--
-- WHAT THIS IS NOT: a shared join code. A code passed around a clinic is
-- a bearer secret — it gets texted, written on the break-room whiteboard,
-- and keeps working after the person is gone. There is no per-person
-- revocation and the audit trail cannot say who used it.
--
-- WHAT THIS IS: one link, minted for one address, mailed to that address,
-- dead after 72 hours or one use, revocable by an administrator at any
-- moment before that. The address is still the identity; the link only
-- proves the person reading the mailbox is the person invited.
--
-- WHY 72 HOURS. The sign-in code is ten minutes because the person is
-- standing at the screen having just asked for it. An invitation is
-- different: it arrives while a new hire is mid-shift, or on a Friday
-- before two days off. Ten minutes would mean every invitation needing a
-- resend, and an administrator who resends five times a day stops reading
-- what they click. Three days covers a weekend and still expires well
-- inside a notice period.
-- ============================================================

alter table staff.org_invites
  add column if not exists token_hash  text,
  add column if not exists expires_at  timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists job_role    text,
  add column if not exists sent_at     timestamptz,
  add column if not exists sent_count  int not null default 0;

-- THE TOKEN IS NEVER STORED. Only its SHA-256, exactly as the surveyor
-- links and the sign-in codes do it. A stolen database backup must not
-- be a set of working invitations.
do $$ begin
  alter table staff.org_invites
    add constraint staff_invite_token_is_a_hash
    check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;

-- A DOMAIN INVITE CANNOT CARRY A LINK. Mailing "everyone at
-- buchmedical.com" has no address to send to, and a link that admits
-- anyone at a domain is the shared code this migration exists to avoid.
do $$ begin
  alter table staff.org_invites
    add constraint staff_invite_link_needs_an_address
    check (token_hash is null or email is not null);
exception when duplicate_object then null;
end $$;

-- An accepted or expired invitation must not be findable by token. The
-- partial index is the lookup path and deliberately excludes both.
create index if not exists staff_invites_by_token
  on staff.org_invites (token_hash)
  where token_hash is not null
    and revoked_at is null
    and accepted_at is null;

-- One live invitation per address per org. Re-inviting somebody replaces
-- the previous link rather than leaving two valid ones in two mailboxes.
create unique index if not exists staff_invites_one_live_per_email
  on staff.org_invites (org_slug, lower(email))
  where email is not null
    and revoked_at is null
    and accepted_at is null;

-- ------------------------------------------------------------
-- What an administrator sees
-- ------------------------------------------------------------
drop view if exists staff.pending_invites cascade;
create view staff.pending_invites
with (security_invoker = true) as
select i.id,
       i.org_slug,
       i.email,
       i.role::text            as role,
       i.job_role,
       i.created_at,
       i.expires_at,
       i.sent_at,
       i.sent_count,
       (i.expires_at <= now()) as expired,
       u.name                  as invited_by_name
  from staff.org_invites i
  left join staff.users u on u.id = i.invited_by
 where i.email is not null
   and i.revoked_at is null
   and i.accepted_at is null
 order by i.created_at desc;

grant select on staff.pending_invites to staff_app;

-- ------------------------------------------------------------
-- Termination closes the door in both places
-- ------------------------------------------------------------
--
-- Deactivating somebody who has signed in sets staff.users.active =
-- false. That alone is not enough: if their original invitation is still
-- live they can walk back in through the link in their mailbox and get a
-- fresh user row. So deactivation revokes the invitation too.
--
-- A trigger rather than application code, because there is more than one
-- route to active = false and the one that forgets is the one that
-- matters.
create or replace function staff.revoke_invites_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.active and not new.active then
    update staff.org_invites
       set revoked_at = now()
     where org_slug = new.org_slug
       and lower(email) = lower(new.email)
       and revoked_at is null
       and accepted_at is null;
  end if;
  return new;
end $$;

drop trigger if exists staff_users_deactivate_revokes_invite on staff.users;
create trigger staff_users_deactivate_revokes_invite
  after update of active on staff.users
  for each row
  execute function staff.revoke_invites_on_deactivate();

-- ------------------------------------------------------------
-- RLS and privileges
-- ------------------------------------------------------------
--
-- staff-schema.sql sets ALTER DEFAULT PRIVILEGES granting DELETE on
-- future tables in this schema. org_invites predates that, but the
-- revoke is restated here so a re-run cannot leave DELETE behind: an
-- invitation is revoked, never deleted, so that "who let this person in"
-- still has an answer a year later.
revoke delete on staff.org_invites from staff_app;
grant select, insert, update on staff.org_invites to staff_app;


-- ========== staff-signup-guard.sql ==========

-- ============================================================
-- 40. SIGNUP IS FOR OWNERS. STAFF ARE INVITED, NEVER SELF-SERVE.
--
-- /start provisions a clinic. Nothing stopped a medical assistant at an
-- already-onboarded clinic typing their clinic's name into it and
-- getting a SECOND workspace: same clinic, same staff, two boards, two
-- sets of logs, and a surveyor eventually shown the emptier one.
--
-- The existing guard only caught the case where the person already held
-- an invite. Somebody with no invite — which is precisely the person who
-- should not be here — sailed through.
--
-- WHY THE EMAIL DOMAIN. A clinic's staff share a mail domain and almost
-- nothing else that is knowable before authentication. Matching on
-- clinic NAME would refuse "Riverside Urgent Care" in two states, which
-- are genuinely different customers.
--
-- FREE MAIL IS EXEMPT, and has to be: two unrelated owners on gmail.com
-- are not the same clinic, and blocking the second would be refusing a
-- customer to prevent a typo.
-- ============================================================

create or replace function staff.domain_taken(p_email text)
returns table (org_slug text, org_name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with d as (
    select lower(split_part(p_email, '@', 2)) as dom
  )
  select o.slug, o.name
    from d
    join staff.org_invites i
      on lower(split_part(i.email, '@', 2)) = d.dom
    join staff.orgs o on o.slug = i.org_slug
   where d.dom <> ''
     and d.dom not in (
       'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com',
       'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
       'icloud.com', 'me.com', 'mac.com', 'aol.com',
       'proton.me', 'protonmail.com', 'pm.me',
       'gmx.com', 'mail.com', 'zoho.com', 'yandex.com'
     )
   limit 1;
$$;

revoke all on function staff.domain_taken(text) from public;
grant execute on function staff.domain_taken(text) to staff_app;


-- ========== staff-immutability.sql ==========

-- ============================================================
-- APPEND-ONLY, ENFORCED — and a hash chain over the result
--
-- The schema always said corrections create a new row pointing at the
-- one it supersedes. The database never enforced it: line 299 of
-- staff-schema.sql grants select, insert, update, delete on every table
-- in the schema to staff_app, sixteen tables take DELETE back, and the
-- two that matter most — the shift logs and the signatures — took back
-- nothing. So "nothing can be backdated or deleted", which this product
-- says on its homepage, was a property of the application code rather
-- than of the database. That is exactly the assurance an auditor
-- discounts, and rightly.
--
-- Three layers here, weakest to strongest:
--   1. Grants     — staff_app loses UPDATE and DELETE.
--   2. Triggers   — refused even if a later migration re-grants.
--   3. Hash chain — tampering by someone who can bypass both is still
--                   DETECTABLE, which is the only property that
--                   survives an attacker with database access.
--
-- WHAT LAYER 3 DOES AND DOES NOT BUY. A superuser can disable a trigger
-- and rewrite rows. What they cannot do cheaply is rewrite them
-- consistently: every row commits to the one before it, so changing an
-- entry from March means recomputing every row since. And because the
-- daily report already emails the chain head to the owner, breaking it
-- silently means also reaching into a mailbox outside this database.
-- That is the difference between "trust us" and "here is something you
-- can check".
-- ============================================================

-- ---------- 1. Corrections have to say why ----------
alter table staff.form_responses
  add column if not exists correction_reason text;

do $$ begin
  alter table staff.form_responses
    add constraint staff_response_correction_has_a_reason
    -- `correction_reason is not null` is not redundant with the length
    -- test. A CHECK passes when it evaluates to NULL, and
    -- length(btrim(NULL)) >= 20 is NULL, not false — so without this the
    -- one case the constraint exists to forbid, a correction filed with
    -- no reason at all, was accepted silently. Caught by testing it.
    check (
      (supersedes_id is null and correction_reason is null)
      or
      (supersedes_id is not null
       and correction_reason is not null
       and length(btrim(correction_reason)) >= 20)
    );
exception when duplicate_object then null;
end $$;

comment on column staff.form_responses.correction_reason is
  'Why this entry supersedes another. Twenty characters minimum, for the '
  'same reason corrective_action has a floor: "typo" is not a reason a '
  'surveyor can evaluate three years later.';

-- ---------- 2. The hash chain ----------
alter table staff.form_responses
  add column if not exists prev_hash text,
  add column if not exists row_hash  text;

do $$ begin
  alter table staff.form_responses
    add constraint staff_response_hash_shape
    check (row_hash is null or row_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;

-- ONE CHAIN PER CLINIC, not one global chain. A shared chain would make
-- every clinic's verification depend on every other clinic's writes, and
-- would leak the fact of one org's activity into another's records.
create index if not exists staff_responses_chain
  on staff.form_responses (org_slug, submitted_at, id);

create or replace function staff.chain_form_response()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prev text;
begin
  -- SERIALIZE PER ORG. Two concurrent inserts reading the same head
  -- would both commit to it and the chain would fork — a fork is
  -- indistinguishable from a deletion when you walk it later. The lock
  -- is transaction-scoped and per-org, so one clinic's morning rush
  -- never waits on another's.
  perform pg_advisory_xact_lock(hashtext('staff.chain:' || new.org_slug));

  select row_hash into prev
    from staff.form_responses
   where org_slug = new.org_slug and row_hash is not null
   order by submitted_at desc, id desc
   limit 1;

  new.prev_hash := prev;

  -- Everything that would matter to a surveyor goes into the digest.
  -- coalesce throughout: in Postgres, concatenating a NULL yields NULL,
  -- and a NULL digest input would silently produce the same hash for
  -- every row that has one empty field.
  new.row_hash := encode(
    sha256(convert_to(
      coalesce(prev, '')                             || '|' ||
      new.id::text                                   || '|' ||
      new.org_slug                                   || '|' ||
      new.instance_id::text                          || '|' ||
      new.submitted_by::text                         || '|' ||
      to_char(new.submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' ||
      new.answers_json::text                         || '|' ||
      coalesce(new.status, '')                       || '|' ||
      coalesce(new.corrective_action, '')            || '|' ||
      coalesce(new.supersedes_id::text, '')          || '|' ||
      coalesce(new.correction_reason, '')            || '|' ||
      coalesce(new.location_status, '')              || '|' ||
      coalesce(new.filed_distance_m::text, '')       || '|' ||
      coalesce(new.location_note, '')
    , 'UTF8')),
  'hex');

  return new;
end $$;

drop trigger if exists staff_form_responses_chain on staff.form_responses;
create trigger staff_form_responses_chain
  before insert on staff.form_responses
  for each row execute function staff.chain_form_response();

-- ---------- 3. Refuse UPDATE and DELETE outright ----------
create or replace function staff.refuse_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'staff.% is append-only: % is refused. Corrections insert a new row '
    'with supersedes_id and correction_reason set.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists staff_form_responses_append_only on staff.form_responses;
create trigger staff_form_responses_append_only
  before update or delete on staff.form_responses
  for each row execute function staff.refuse_mutation();

drop trigger if exists staff_attestations_append_only on staff.attestations;
create trigger staff_attestations_append_only
  before update or delete on staff.attestations
  for each row execute function staff.refuse_mutation();

-- The grants, so the refusal happens before a statement is even planned.
revoke update, delete on staff.form_responses from staff_app;
revoke update, delete on staff.attestations   from staff_app;

-- ---------- 4. Walking the chain ----------
-- Returns nothing when the chain is intact. Any row it returns is a row
-- whose stored hash disagrees with its contents, or whose link to the
-- previous row is broken — which is what tampering looks like after the
-- fact.
create or replace function staff.verify_log_chain(p_org text)
returns table (
  response_id  uuid,
  submitted_at timestamptz,
  problem      text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r        record;
  expected text;
  prev     text := null;
begin
  for r in
    select * from staff.form_responses
     where org_slug = p_org and row_hash is not null
     order by submitted_at, id
  loop
    expected := encode(sha256(convert_to(
      coalesce(prev, '')                          || '|' ||
      r.id::text                                  || '|' ||
      r.org_slug                                  || '|' ||
      r.instance_id::text                         || '|' ||
      r.submitted_by::text                        || '|' ||
      to_char(r.submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' ||
      r.answers_json::text                        || '|' ||
      coalesce(r.status, '')                      || '|' ||
      coalesce(r.corrective_action, '')           || '|' ||
      coalesce(r.supersedes_id::text, '')         || '|' ||
      coalesce(r.correction_reason, '')           || '|' ||
      coalesce(r.location_status, '')             || '|' ||
      coalesce(r.filed_distance_m::text, '')      || '|' ||
      coalesce(r.location_note, '')
    , 'UTF8')), 'hex');

    if r.prev_hash is distinct from prev then
      response_id := r.id; submitted_at := r.submitted_at;
      problem := 'link broken: a row before this one was altered or removed';
      return next;
    elsif r.row_hash <> expected then
      response_id := r.id; submitted_at := r.submitted_at;
      problem := 'contents altered after filing';
      return next;
    end if;

    prev := r.row_hash;
  end loop;
end $$;

revoke all on function staff.verify_log_chain(text) from public;
grant execute on function staff.verify_log_chain(text) to staff_app;

-- The current head, for the daily report to carry into somebody's inbox.
create or replace function staff.log_chain_head(p_org text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select row_hash from staff.form_responses
   where org_slug = p_org and row_hash is not null
   order by submitted_at desc, id desc limit 1;
$$;

revoke all on function staff.log_chain_head(text) from public;
grant execute on function staff.log_chain_head(text) to staff_app;


-- ========== staff-amend.sql ==========

-- ============================================================
-- AMENDMENTS, AND A THREE-MINUTE HOLD ON THE ALARM
--
-- staff.form_responses has carried supersedes_id since the first
-- migration and nothing has ever written it. Reading the code that is
-- easy to miss: lib/staff/logs.ts filters on `supersedes_id is null` to
-- find the head of the chain, which looks like a correction path is in
-- use. It is not. Nothing inserts a superseding row, and the partial
-- unique index on (instance_id) where supersedes_id is null means a
-- second filing for the same instance is simply rejected. So a medical
-- assistant who typed 55 instead of 38.5 had no way to fix it at all.
--
-- WHAT IS NOT BUILT HERE, DELIBERATELY: a draft state. "Let them edit
-- until they send it" is an unrecorded editing window, which is the
-- exact hole staff-immutability.sql just closed. A fridge that reads 55
-- and becomes 38.5 before anybody else sees it leaves no evidence that
-- 55 was ever observed, and that evidence is the product.
--
-- So: amending is always allowed and always recorded. The only thing
-- with a clock on it is the ALARM. Three minutes, chosen because a
-- transposed digit is noticed in the same breath while a genuinely warm
-- fridge is still savable; ten minutes of silence on a real excursion
-- costs a vaccine lot and a letter to every patient dosed from it.
-- ============================================================

-- ---------- 1. The hold ----------
alter table staff.alert_queue
  add column if not exists hold_until  timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_reason text;

comment on column staff.alert_queue.hold_until is
  'The sweep will not send before this instant. Null means send now, '
  'which is every alert that is not an amendable excursion.';

-- A cancelled alert is kept, never deleted. "We nearly texted you about
-- a fridge at 55 and then the reading was corrected" is itself
-- information an administrator may want, and the row is the only place
-- it exists.
create index if not exists staff_alert_queue_held
  on staff.alert_queue (org_slug, hold_until)
  where cancelled_at is null and hold_until is not null;

-- ---------- 2. Amending, as one indivisible act ----------
-- SECURITY DEFINER and one function rather than three statements in the
-- route, because the insert and the alert cancellation must not be able
-- to half-happen. A superseding row with the original's alarm still
-- armed texts the director about a value nobody believes any more.
create or replace function staff.amend_response(
  p_org       text,
  p_response  uuid,
  p_user      uuid,
  p_answers   jsonb,
  p_reason    text,
  p_flagged   boolean,
  -- text[], matching the column. Declared as jsonb in the first draft,
  -- which the type checker caught only because this was run against a
  -- real Postgres rather than reasoned about.
  p_out_of_range text[],
  p_corrective   text,
  -- The amendment's OWN location. Passing the original's would assert
  -- that the correction happened where the filing did, which is the kind
  -- of small untruth that discredits a whole record when a surveyor
  -- finds it. Null when the browser would not say.
  p_lat        double precision default null,
  p_lng        double precision default null,
  p_accuracy_m double precision default null,
  p_distance_m double precision default null,
  p_loc_status text default 'not_asked',
  p_loc_note   text default null
) returns table (new_id uuid, alarm_cancelled boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  orig     staff.form_responses;
  fresh_id uuid;
  killed   boolean := false;
begin
  if length(btrim(coalesce(p_reason, ''))) < 20 then
    raise exception 'an amendment needs a reason of at least 20 characters'
      using errcode = 'check_violation';
  end if;

  select * into orig from staff.form_responses
   where id = p_response and org_slug = p_org;
  if not found then
    raise exception 'no such response in this organization'
      using errcode = 'no_data_found';
  end if;

  -- ONLY THE HEAD MAY BE AMENDED. Amending a row that something already
  -- supersedes would fork the chain, and a fork reads exactly like a
  -- deletion when somebody walks it two years later.
  if exists (select 1 from staff.form_responses
              where supersedes_id = p_response) then
    raise exception 'that entry has already been amended; amend the current one'
      using errcode = 'restrict_violation';
  end if;

  insert into staff.form_responses
    (instance_id, org_slug, submitted_by, answers_json, status,
     has_out_of_range, out_of_range_fields, corrective_action,
     filed_lat, filed_lng, filed_accuracy_m, filed_distance_m,
     location_status, location_note,
     supersedes_id, correction_reason)
  values
    (orig.instance_id, p_org, p_user, p_answers,
     case when p_flagged then 'flagged' else 'pending' end,
     p_flagged, p_out_of_range,
     case when p_flagged then p_corrective else null end,
     p_lat, p_lng, p_accuracy_m, p_distance_m,
     coalesce(p_loc_status, 'not_asked'), p_loc_note,
     p_response, btrim(p_reason))
  returning id into fresh_id;

  -- Cancel the original's alarm only while it is still held. Past the
  -- hold the message has gone; marking it cancelled would claim
  -- something false about a mail that is already in somebody's pocket.
  update staff.alert_queue
     set cancelled_at = now(),
         cancelled_reason = 'superseded within the hold: ' || btrim(p_reason)
   where org_slug = p_org
     and source_kind = 'form_response'
     and source_id = p_response
     and cancelled_at is null
     and hold_until is not null
     and hold_until > now()
     and owner_sent_at is null
     and director_sent_at is null;

  killed := found;

  new_id := fresh_id;
  alarm_cancelled := killed;
  return next;
end $$;

-- The old four-and-four signature is dropped, not left beside the new
-- one: a defaulted argument makes a DIFFERENT function, and two
-- overloads of the same name is how provision_trial 500ed every signup.
drop function if exists staff.amend_response(text, uuid, uuid, jsonb, text, boolean, jsonb, text);
revoke all on function staff.amend_response(text, uuid, uuid, jsonb, text, boolean, text[], text, double precision, double precision, double precision, double precision, text, text) from public;
grant execute on function staff.amend_response(text, uuid, uuid, jsonb, text, boolean, text[], text, double precision, double precision, double precision, double precision, text, text) to staff_app;

-- ---------- 3. The live board ----------
-- Everything filed today, newest first, amendments included and marked
-- as such. One query rather than a join the page has to assemble, so the
-- board can poll cheaply.
drop view if exists staff.activity_today cascade;
create view staff.activity_today
with (security_invoker = true) as
select r.id,
       r.org_slug,
       t.name                     as form_name,
       i.slot,
       r.submitted_at,
       u.name                     as filed_by,
       r.status,
       r.has_out_of_range,
       r.corrective_action,
       r.location_status,
       r.filed_distance_m,
       r.location_note,
       r.supersedes_id is not null as is_amendment,
       r.correction_reason,
       -- Null on the head of every chain; set on a row that something
       -- newer has replaced, which is how the board greys it out.
       (select x.id from staff.form_responses x
         where x.supersedes_id = r.id limit 1) as superseded_by
  from staff.form_responses r
  join staff.form_instances i on i.id = r.instance_id
  join staff.form_templates t on t.id = i.template_id
  left join staff.users u on u.id = r.submitted_by
 where r.submitted_at >= now() - interval '36 hours'
 order by r.submitted_at desc;

grant select on staff.activity_today to staff_app;

-- ---------- 4. "The current version" was selecting the ORIGINAL ----------
--
-- This is the bug that would have made every amendment invisible, and it
-- was latent only because nothing ever wrote supersedes_id.
--
-- A correction inserts a row whose supersedes_id points BACKWARDS at the
-- entry it replaces. So the newest row in a chain is the one carrying a
-- supersedes_id, and the oldest — the mistake — is the one with null.
-- Every read path tested `supersedes_id is null`, which selects the
-- ORIGINAL. Switch amendments on without this and the board, the
-- surveyor vault and today's log all keep showing 55°F forever while the
-- correction sits in the table unread.
--
-- The head of a chain is the row that nothing supersedes. That cannot be
-- a partial index, so it is a NOT EXISTS — and staff.amend_response
-- refuses to amend an already-amended row, which keeps every chain
-- linear and this test single-valued.
--
-- The unique index staff_responses_one_live is deliberately left alone:
-- read correctly it says "one ORIGINAL per instance", which is still
-- exactly the double-filing guard it was written to be. Amendments carry
-- a supersedes_id and fall outside it.

drop view if exists staff.todays_logs cascade;
create view staff.todays_logs
with (security_invoker = true) as
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
  u.legal_name    as submitted_by_name,
  u.email         as submitted_by_email
from staff.form_templates t
cross join lateral unnest(
  case when cardinality(t.slots) = 0 then array[''] else t.slots end
) as s(slot)
left join staff.form_instances i
  on i.template_id = t.id and i.due_date = current_date and i.slot = s.slot
left join staff.form_responses r
  on r.instance_id = i.id
 and not exists (
       select 1 from staff.form_responses newer
        where newer.supersedes_id = r.id
     )
left join staff.users u on u.id = r.submitted_by
where t.active;

grant select on staff.todays_logs to staff_app;

-- ---------- 5. Put back what the cascade took ----------
--
-- `drop view staff.todays_logs cascade` also drops staff.overdue_today,
-- which is built on it and drives the missed-task alerts. The cascade is
-- necessary — the view's column list changes, and Postgres will not
-- replace a view whose columns move — but a migration that silently
-- removes the late-task detector and leaves it removed is worse than one
-- that fails. Recreated verbatim from staff-alerts.sql.
create or replace view staff.overdue_today
with (security_invoker = true) as
select
  l.org_slug,
  l.template_id,
  l.slug,
  l.name,
  l.slot,
  l.job_roles,
  (now() at time zone o.timezone)::time as local_now,
  o.timezone
from staff.todays_logs l
join staff.orgs o on o.slug = l.org_slug
where l.response_id is null
  and (
    (l.slot = 'am' and (now() at time zone o.timezone)::time > time '11:00')
    or (l.slot = 'pm' and (now() at time zone o.timezone)::time
          > (o.operating_hours_end - interval '1 hour'))
  );

grant select on staff.overdue_today to staff_app;


-- ========== staff-statutory-logs.sql ==========

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

-- `drop view staff.todays_logs cascade` above also drops
-- staff.overdue_today, which is built on top of it and drives the
-- missed-task alerts — the same cascade staff-amend.sql already had to
-- put back for the same reason. That fix only covers amend's own drop;
-- this one, done after it, needed the identical repair and never got it,
-- so the alert view has been missing from every deployment that reached
-- this file, silently, since the day this migration first ran. Recreated
-- verbatim from staff-alerts.sql — every column it reads (org_slug,
-- template_id, slug, name, slot, job_roles, response_id) is still
-- present on the todays_logs shape above, so nothing else changes.
create or replace view staff.overdue_today
with (security_invoker = true) as
select
  l.org_slug,
  l.template_id,
  l.slug,
  l.name,
  l.slot,
  l.job_roles,
  (now() at time zone o.timezone)::time as local_now,
  o.timezone
from staff.todays_logs l
join staff.orgs o on o.slug = l.org_slug
where l.response_id is null
  and (
    (l.slot = 'am' and (now() at time zone o.timezone)::time > time '11:00')
    or (l.slot = 'pm' and (now() at time zone o.timezone)::time
          > (o.operating_hours_end - interval '1 hour'))
  );

grant select on staff.overdue_today to staff_app;

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


-- ========== staff-credential-matrix.sql ==========

-- ============================================================
-- THE CREDENTIALING MATRIX
--
-- Everything this needs already exists: staff.credentials holds one row
-- per person per credential with an expiry, and
-- staff.job_credential_requirements says which kinds each job must
-- carry. What was missing is the shape an administrator actually reads —
-- a grid of people against credentials where the colour of a cell is the
-- whole answer.
--
-- THE ROW THAT MATTERS IS THE MISSING ONE. A per-person document shelf
-- shows what somebody HAS; it cannot show what they have not got, and
-- "the x-ray tech never uploaded an ARRT card" is precisely the finding a
-- surveyor writes up. So this starts from the REQUIREMENT and left-joins
-- the credential, not the other way round.
--
-- Ninety days because that is roughly a renewal cycle for BLS and ACLS:
-- long enough to book a class, short enough that the warning still means
-- something when it appears.
-- ============================================================

drop view if exists staff.credential_matrix cascade;
create view staff.credential_matrix
with (security_invoker = true) as
select
  u.org_slug,
  u.id                as user_id,
  u.name              as staff_name,
  u.legal_name,
  u.job_role,
  req.kind::text      as kind,
  coalesce(req.label, req.kind::text) as kind_label,
  req.required,
  req.sort_order,
  c.id                as credential_id,
  c.expires_on,
  (c.expires_on - current_date) as days_left,
  case
    when c.id is null                                      then 'missing'
    -- A credential with no expiry date is a credential nobody can
    -- evidence the currency of. Treated as present but unverifiable
    -- rather than silently counted as fine.
    when c.expires_on is null                              then 'undated'
    when c.expires_on < current_date                       then 'expired'
    when c.expires_on <= current_date + 90                 then 'expiring'
    else 'current'
  end as status
from staff.users u
join staff.job_credential_requirements req
  on req.org_slug = u.org_slug
 and req.job_role = u.job_role
 and req.active
left join lateral (
  -- The furthest-out valid card wins when somebody has renewed early and
  -- both the old and new are on file. Picking the newest by created_at
  -- would show the old one whenever the renewal was uploaded first.
  select c2.id, c2.expires_on
    from staff.credentials c2
   where c2.user_id = u.id
     and c2.kind = req.kind
     and c2.active
   order by c2.expires_on desc nulls last
   limit 1
) c on true
where u.active
  and u.job_role is not null;

grant select on staff.credential_matrix to staff_app;

-- The one number an owner wants without reading the grid.
drop view if exists staff.credential_gaps cascade;
create view staff.credential_gaps
with (security_invoker = true) as
select org_slug,
       count(*) filter (where status = 'expired'  and required) as expired_required,
       count(*) filter (where status = 'missing'  and required) as missing_required,
       count(*) filter (where status = 'expiring' and required) as expiring_required,
       count(*) filter (where status = 'undated'  and required) as undated_required
  from staff.credential_matrix
 group by org_slug;

grant select on staff.credential_gaps to staff_app;


-- ========== staff-sharps-waste.sql ==========

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


-- ========== staff-provision-seed.sql ==========

-- ============================================================
-- A CLINIC THAT PAID GETS A CLINIC
--
-- staff.provision_org creates the org and the first administrator's
-- invite and stops. staff.provision_trial, since staff-facility.sql,
-- also calls staff.seed_facility — so somebody who signs up at /start
-- gets a working board and somebody who pays through the Stripe link
-- gets an empty one. Same product, two doors, opposite outcomes, and the
-- worse outcome belongs to the person who paid.
--
-- Confirmed in a live test rather than reasoned about: a test-mode
-- checkout against the real webhook returned
--   {"received": true, "provisioned": "test-clinic-admin"}
-- and that clinic has no templates at all.
--
-- WHY THE FACILITY TYPE IS urgent_care HERE. A Payment Link cannot ask
-- what kind of clinic you are — it collects a name and a card. The
-- honest options were to guess or to leave the board empty, and an
-- urgent-care board an owner prunes beats a blank page with no
-- explanation. /start still asks properly, which is the door to prefer.
-- ============================================================

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

  -- The person who paid is the first administrator. Without this they
  -- would complete checkout and have nothing to sign into.
  insert into staff.org_invites (org_slug, email, role)
  values (final_slug, lower(p_email), 'org_admin');

  -- The line whose absence meant a paying customer opened an empty board.
  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.provision_org(text, text, text, text, text) from public;
grant execute on function staff.provision_org(text, text, text, text, text) to staff_app;

-- ---------- Repair anything already provisioned this way ----------
-- Orgs created through checkout before this fix have no templates. Seed
-- them now rather than leaving a customer to discover it. seed_facility
-- skips slugs a clinic already has, so this is safe for orgs that were
-- provisioned correctly.
do $$
declare r record;
begin
  for r in
    select o.slug from staff.orgs o
     where o.plan = 'stripe'
       and not o.is_library
       and not exists (
             select 1 from staff.form_templates t where t.org_slug = o.slug
           )
  loop
    update staff.orgs set facility_type = coalesce(facility_type, 'urgent_care')
     where slug = r.slug;
    perform staff.seed_facility(r.slug);
    raise notice 'seeded templates for stripe-provisioned org %', r.slug;
  end loop;
end $$;


-- ========== staff-org-settings.sql ==========

-- ============================================================
-- AN OWNER CAN SET THEIR CLINIC'S SETTINGS. ONLY THOSE.
--
-- staff.orgs carries two very different kinds of column on one row:
--
--   the clinic's own settings — timezone, coordinates, geofence, who to
--   alert — which the owner must be able to change; and
--
--   the billing state — is_read_only, subscription_status, trial_ends_on,
--   the Stripe ids — which only the signed webhook may write.
--
-- The RLS policy reflects that: USING lets an administrator READ their
-- own org, WITH CHECK requires a super admin to WRITE it. Correct, and it
-- is why /staff/settings failed with "new row violates row-level security
-- policy for table orgs" the first time it was run against a real
-- database as staff_app.
--
-- WIDENING THE POLICY WOULD BE THE WRONG FIX. Postgres row-level security
-- is row-level, not column-level: a policy permissive enough to let an
-- owner set their timezone would also let them set is_read_only = false
-- and use the product for nothing. So the write goes through a function
-- that can only reach the settings columns, and the billing columns stay
-- unreachable from the application at all.
-- ============================================================

create or replace function staff.update_org_settings(
  p_org        text,
  p_timezone   text,
  p_latitude   double precision,
  p_longitude  double precision,
  p_radius_m   integer,
  p_mode       text,
  p_owner_email text,
  p_md_email    text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Region/City only. 'EST' has no daylight-saving rule and every
  -- reminder and report drifts by an hour for half the year.
  if p_timezone !~ '^[A-Za-z]+/[A-Za-z0-9_+-]+$' then
    raise exception 'timezone must be a Region/City name, not %', p_timezone
      using errcode = 'check_violation';
  end if;

  -- Half a coordinate would place the clinic on the equator or the prime
  -- meridian and stamp every filing thousands of miles from the door.
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'latitude and longitude must both be set or both be null'
      using errcode = 'check_violation';
  end if;

  update staff.orgs set
    timezone                     = p_timezone,
    latitude                     = p_latitude,
    longitude                    = p_longitude,
    geofence_radius_m            = p_radius_m,
    geofence_mode                = p_mode,
    owner_alert_email            = nullif(btrim(coalesce(p_owner_email, '')), ''),
    medical_director_alert_email = nullif(btrim(coalesce(p_md_email, '')), '')
  where slug = p_org;

  if not found then
    raise exception 'no such organization: %', p_org
      using errcode = 'no_data_found';
  end if;
end $$;

revoke all on function staff.update_org_settings(
  text, text, double precision, double precision, integer, text, text, text
) from public;
grant execute on function staff.update_org_settings(
  text, text, double precision, double precision, integer, text, text, text
) to staff_app;



-- ============================================================
-- medicin. STAFF MODULE — SETUP PART 2 OF 5
--
-- RUN THE PARTS IN ORDER, 1 through 5, each as its own paste.
-- Wait for one to report success before starting the next; a later part
-- refers to tables an earlier one creates.
--
-- Every part is idempotent on its own, so re-running one is safe and a
-- part that half-succeeded can simply be run again.
--
-- Migrations in this part:
--   staff-job-roles-seed
--   staff-credentials
--   staff-credentials-seed
--   staff-scope
--   staff-scope-seed
--   staff-rounds
--   staff-rounds-seed
--   staff-onboarding-wizard
--   staff-onboarding-wizard-seed
--   staff-documents
--   staff-credential-kinds-hr
--   staff-protocols
--   staff-protocols-seed
--   staff-emergency
-- ============================================================

-- ========== staff-job-roles-seed.sql ==========

-- ============================================================
-- WHO DOES WHAT, AND THE RULES THEY WORK UNDER
--
-- Run AFTER supabase/staff-job-roles.sql. Idempotent.
--
-- Two halves:
--   1. Assign the seven binder logs to the job that actually performs
--      them, and add the front-desk tasks that had no log at all.
--   2. Seed the standing directives each role works under.
--
-- ACCURACY NOTE. The thresholds and intervals here come from the same
-- sources as the log seed: 36-46 degF for vaccine storage, 1000 PSI on
-- an E-cylinder, ANSI Z358.1's weekly eyewash activation, 28-day
-- beyond-use dating on an opened multi-dose vial. The DIRECTIVES are
-- practice rules, not regulations, except where a citation is given —
-- and where one is given it is exact. A directive that cites a rule it
-- misstates is worse than one that cites nothing.
-- ============================================================

-- ---------- 1. Assign the existing logs to a job ----------
--
-- The narcotics count is deliberately assigned to TWO jobs. It is a
-- dual-witness count: one person counts, another witnesses, and the
-- pair is the control. Assigning it to one job would put the second
-- signature outside the brief of the person being asked for it.

update staff.form_templates set job_roles = array['medical_assistant']::staff.job_role[]
  where slug in ('crash-cart', 'temp-fridge', 'poct-qc');

update staff.form_templates set job_roles = array['medical_assistant','xray_tech']::staff.job_role[]
  where slug = 'eyewash-autoclave';

update staff.form_templates set job_roles = array['xray_tech']::staff.job_role[]
  where slug = 'radiation-apron';

update staff.form_templates set job_roles = array['medical_assistant','provider']::staff.job_role[]
  where slug = 'narcotics-count';

update staff.form_templates set job_roles = array['provider','center_admin']::staff.job_role[]
  where slug = 'qi-minutes';

-- ---------- 2. The front desk had no daily log at all ----------
--
-- Every one of the seven binder sheets is clinical, so on a role-scoped
-- brief the front desk would have opened the app to an empty shift.
-- That is not a filtering bug, it is a gap in the binder: the money and
-- the privacy screen are as auditable as the fridge.

insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots, sort_order,
   job_roles, schema_json)
select o.slug, t.slug, t.name, t.description, t.category, t.frequency,
       t.slots, t.sort_order, t.job_roles, t.schema_json::jsonb
from staff.orgs o
cross join (values
  ('front-desk-open',
   'Front desk opening',
   'Drawer count, privacy screens, lobby walk.',
   'operations', 'daily', array['am'], 5,
   array['front_desk']::staff.job_role[],
   $json$
   {
     "standard": "Drawer counted against yesterday's close before the first patient. Check-in screens angled away from the lobby.",
     "fields": [
       { "id": "drawer_open", "label": "Opening drawer count", "type": "number",
         "unit": "USD", "step": 0.01,
         "help": "Count it before the first patient, not after. A discrepancy found at 5pm cannot be pinned to a shift." },
       { "id": "drawer_matches", "label": "Matches yesterday's closing count", "type": "boolean", "expected": true },
       { "id": "screens_private", "label": "Check-in screens not visible from the lobby", "type": "boolean", "expected": true,
         "help": "Walk out and look from a waiting-room chair. 45 CFR 164.530(c) asks for reasonable safeguards, and a screen angle is the cheapest one there is." },
       { "id": "lobby_clear", "label": "Lobby walk done: exits clear, no PHI left out", "type": "boolean", "expected": true },
       { "id": "shred_secured", "label": "Shred bin locked and not overflowing", "type": "boolean", "expected": true }
     ]
   }
   $json$),
  ('front-desk-close',
   'Front desk closing',
   'Drawer reconciliation and end-of-day PHI sweep.',
   'operations', 'daily', array['pm'], 95,
   array['front_desk']::staff.job_role[],
   $json$
   {
     "standard": "Closing count reconciles to the day's posted payments. Nothing with a patient name left on a desk.",
     "fields": [
       { "id": "drawer_close", "label": "Closing drawer count", "type": "number", "unit": "USD", "step": 0.01 },
       { "id": "posted_total", "label": "Payments posted today", "type": "number", "unit": "USD", "step": 0.01 },
       { "id": "reconciles", "label": "Counted cash reconciles to posted payments", "type": "boolean", "expected": true,
         "help": "If it does not, say so and write what you found. A silent shortfall is the one that becomes an investigation." },
       { "id": "phi_cleared", "label": "No paper with patient identifiers left on any desk", "type": "boolean", "expected": true },
       { "id": "workstations_locked", "label": "All workstations logged out", "type": "boolean", "expected": true }
     ]
   }
   $json$)
) as t(slug, name, description, category, frequency, slots, sort_order, job_roles, schema_json)
where not exists (
  select 1 from staff.form_templates f
   where f.org_slug = o.slug and f.slug = t.slug
);

-- ---------- 3. Standing directives ----------

create or replace function staff.seed_directives(p_slug text)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into staff.directives
    (org_slug, key, job_roles, title, body, rationale, citation, critical, sort_order)
  select p_slug, d.key, d.job_roles, d.title, d.body, d.rationale, d.citation, d.critical, d.sort_order
  from (values

    -- Everyone
    ('phi-in-chat', '{}'::staff.job_role[],
     'No patient information in this app',
     'Never type a patient name, date of birth, MRN, or anything that identifies a person into a log, a note, or a message here. Describe the room, the cart, or the reading.',
     'This product holds no PHI, which is why it needs no BAA and why a breach here cannot expose a patient. That is true only for as long as nobody types it in.',
     '45 CFR 164.502', true, 10),

    ('escalate-emergency', '{}'::staff.job_role[],
     'Anyone can call a code',
     'If a patient in the lobby or a room looks like they are deteriorating, say so immediately and out loud. You do not need to be clinical to escalate, and you will never be criticised for escalating something that turned out to be nothing.',
     'The delay that hurts people is almost never a wrong clinical judgement. It is somebody junior deciding it was not their place to speak.',
     null, true, 20),

    -- Front desk
    ('no-clinical-advice', array['front_desk']::staff.job_role[],
     'Never give clinical advice or triage over the desk',
     'If a patient asks whether their symptom is serious, whether they should be seen, or what a result means, do not answer. Say: "Let me get a clinical staff member to answer that for you," and get one.',
     'A reassuring answer from the desk is practising medicine without a licence, and it is the answer people remember when they decide to go home instead of being seen.',
     null, true, 30),

    ('billing-redirect', array['medical_assistant','xray_tech','provider']::staff.job_role[],
     'Send every pricing question to the front desk',
     'If a patient asks what a visit costs, what their copay is, or whether insurance covers something, do not estimate. Say: "Our front desk handles all account and payment details — I will walk you over at checkout so they can help you directly."',
     'A number guessed in an exam room becomes a number the patient was quoted. It also puts a clinical person in the middle of a billing dispute, which is exactly where the therapeutic relationship goes to die.',
     null, false, 40),

    ('verify-identity', array['front_desk']::staff.job_role[],
     'Two identifiers at check-in, every time',
     'Full name and date of birth, said back by the patient rather than read to them. Never confirm a chart by asking "you are Mrs Smith, yes?"',
     'Reading the name out and getting a nod is how one patient gets another patient''s chart, and the error is usually only found after something has been done to somebody.',
     null, true, 50),

    -- Medical assistant
    ('fridge-excursion', array['medical_assistant']::staff.job_role[],
     'An out-of-range fridge means quarantine first, log second',
     'If the vaccine fridge reads outside 36-46 degF: do not discard, do not keep using it. Move stock to the backup unit, tag it DO NOT USE, then log the reading and call the manufacturer or the immunisation programme for a viability decision.',
     'Discarding is expensive and often unnecessary; continuing to use it is the one that reaches a patient. Neither call is yours to make alone, and the manufacturer will ask for the min/max, so read it before you move anything.',
     null, true, 60),

    ('poct-control-fail', array['medical_assistant']::staff.job_role[],
     'A failed control voids the run, not just the control',
     'If an external control does not read as expected, no patient result from that kit and lot may be reported. Open a new lot, repeat the control, and document both the failure and the repeat.',
     'A reported result from a kit whose control failed is an unverified result, and under a CLIA waiver the control is the entire quality system.',
     '42 CFR 493.15', true, 70),

    ('mdv-28-day', array['medical_assistant']::staff.job_role[],
     'Date every multi-dose vial the moment it is opened',
     'Write the beyond-use date on the vial when you first puncture it: 28 days from opening unless the manufacturer says shorter. Lidocaine, PPD tuberculin, bacteriostatic diluents.',
     'An undated open vial has no defensible in-use date, so on inspection it is discarded and on a bad day it is used months later.',
     null, false, 80),

    -- X-ray tech
    ('apron-defect', array['xray_tech']::staff.job_role[],
     'A lead apron that fails inspection comes out of service that shift',
     'Any apron or thyroid collar with a crack, tear, or radiographic defect over the recommended limit is tagged and removed the same day. Do not leave it on the rack "until the next order goes in."',
     'A defective apron is worse than none, because the person wearing it believes they are shielded.',
     null, true, 90),

    ('repeat-image-justify', array['xray_tech']::staff.job_role[],
     'Every repeat exposure gets a reason',
     'If you repeat a view, record why — positioning, motion, technique. Repeats are tracked, and the number is not the point; the pattern is.',
     'Radiation dose is cumulative and the only defensible way to reduce repeats is to know what is causing them.',
     null, false, 100),

    -- Provider
    ('overread-discrepancy', array['provider']::staff.job_role[],
     'Close the loop on every over-read discrepancy',
     'When the radiologist''s read differs from the preliminary read in a way that changes management, the patient is contacted and the contact is documented — who called, when, what was said, and what was arranged.',
     'The discrepancy itself is expected and is not the finding. The finding is a discrepancy nobody told the patient about.',
     null, true, 110),

    ('controlled-cosign', array['provider']::staff.job_role[],
     'Waste is witnessed in real time, not reconstructed',
     'Any partial dose of a controlled substance is wasted in front of a second person and both sign at the moment it happens. Never sign a waste you did not watch.',
     'A co-signature added later is a signature attesting to something the signer did not see, which is the specific thing a diversion investigation looks for.',
     null, true, 120),

    -- Center admin
    ('monthly-oversight', array['center_admin']::staff.job_role[],
     'Sign the month, and read it before you sign',
     'At the close of each month the Lead RN or Center Manager and the Medical Director sign the oversight block. Read the flagged entries and the corrective actions first.',
     'The monthly signature is what turns a stack of staff entries into evidence of clinical oversight. A signature applied without reading is the one a surveyor will find the counter-example to.',
     null, false, 130)

  ) as d(key, job_roles, title, body, rationale, citation, critical, sort_order)
  where not exists (
    select 1 from staff.directives x
     where x.org_slug = p_slug and x.key = d.key
  );

  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function staff.seed_directives(text) to staff_app;

create or replace function staff.directives_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_directives(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_directives on staff.orgs;
create trigger staff_orgs_seed_directives
  after insert on staff.orgs
  for each row execute function staff.directives_seed_new_org();

do $$
declare o record;
begin
  for o in select slug from staff.orgs loop
    perform staff.seed_directives(o.slug);
  end loop;
end $$;


-- ========== staff-credentials.sql ==========

-- ============================================================
-- CREDENTIALS AND EXCLUSION SCREENING
--
-- Run AFTER supabase/staff-job-roles-seed.sql. Idempotent.
--
-- WHY THIS REPLACES THE THREE COLUMNS ON staff.users
--
-- Credentials were bls_expires_on, license_expires_on and arrt_expires_on
-- — three date columns, so a clinic could track exactly three things and
-- adding a fourth was a migration. Real rosters have a DEA registration,
-- malpractice coverage, board certification, ACLS, PALS, a second state
-- licence for someone who works a border site, and a collaborative
-- practice agreement. Those are rows, not columns.
--
-- NO CREDENTIAL NUMBERS ARE STORED, and that is a deliberate refusal
-- rather than an omission. A table holding DEA registration numbers
-- against named prescribers is a prescription-fraud kit; one holding
-- licence numbers with dates of birth is an identity-theft kit. What
-- expiry tracking actually needs is the KIND, the ISSUER and the DATE,
-- and none of those are sensitive. When primary source verification
-- happens, what gets recorded here is that it happened and who did it —
-- the verification itself lives at the source, which is the only place
-- it is authoritative anyway.
-- ============================================================

do $$ begin
  create type staff.credential_kind as enum (
    'state_license',
    'dea_registration',
    'board_certification',
    'bls_cpr',
    'acls',
    'pals',
    'arrt',
    'malpractice',
    'collaborative_agreement',
    'other'
  );
exception when duplicate_object then null;
end $$;

create table if not exists staff.credentials (
  id          uuid primary key default gen_random_uuid(),
  org_slug    text not null references staff.orgs(slug) on delete cascade,
  user_id     uuid not null references staff.users(id) on delete cascade,
  kind        staff.credential_kind not null,
  -- Who issued it: a state code for a licence, a board's name for a
  -- certification, a carrier for malpractice. Free text because the
  -- vocabulary is genuinely open and a wrong enum blocks a real hire.
  issuer      text,
  -- Deliberately NOT the credential number. See the header.
  label       text,
  issued_on   date,
  expires_on  date,
  -- Primary source verification: the date somebody checked this against
  -- the issuing authority, not the date it was typed in.
  verified_on date,
  verified_by uuid references staff.users(id),
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists staff_credentials_user
  on staff.credentials (org_slug, user_id) where active;
create index if not exists staff_credentials_expiry
  on staff.credentials (org_slug, expires_on) where active and expires_on is not null;

alter table staff.credentials enable row level security;
alter table staff.credentials force row level security;
drop policy if exists staff_org_isolation on staff.credentials;
create policy staff_org_isolation on staff.credentials
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());
grant select, insert, update on staff.credentials to staff_app;
revoke delete on staff.credentials from staff_app;

-- Carry the three old columns across, once, so nobody loses a date that
-- was already entered. Guarded on not-exists so re-running cannot create
-- duplicates.
insert into staff.credentials (org_slug, user_id, kind, expires_on)
select u.org_slug, u.id, k.kind, k.d
from staff.users u
cross join lateral (values
  ('bls_cpr'::staff.credential_kind,       u.bls_expires_on),
  ('state_license'::staff.credential_kind, u.license_expires_on),
  ('arrt'::staff.credential_kind,          u.arrt_expires_on)
) as k(kind, d)
where k.d is not null
  and not exists (
    select 1 from staff.credentials c
     where c.user_id = u.id and c.kind = k.kind and c.expires_on = k.d
  );

-- ============================================================
-- EXCLUSION SCREENING
--
-- Employing or contracting with an excluded individual means the federal
-- health care programs will not pay for ANYTHING that person is involved
-- in, directly or indirectly, and civil monetary penalties attach per
-- item or service claimed. The OIG's own guidance is to screen the
-- exclusion list on hire and MONTHLY thereafter, which is why the
-- obligation this seeds repeats monthly rather than annually.
--
-- Sources worth screening:
--   OIG LEIE        — the federal exclusion list, published monthly
--   SAM.gov         — federal procurement/award debarment
--   State Medicaid  — most states publish their own, and a state
--                     exclusion is not always mirrored federally
--
-- WHAT THIS TABLE IS: the record that a screen happened, against whom,
-- on what date, with what result. It is the evidence a surveyor or a
-- payer asks for.
--
-- WHAT IT IS NOT, YET: an automated download. The LEIE is a published
-- CSV and SAM.gov has an API, so screening could be run for the whole
-- roster on a schedule — but a name-only match produces false positives
-- on common names, and resolving one requires a date of birth or an SSN
-- that this system deliberately does not hold. So the check stays human,
-- and what is automated is remembering that it is due.
-- ============================================================

do $$ begin
  create type staff.exclusion_source as enum ('oig_leie', 'sam_gov', 'state_medicaid');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type staff.exclusion_result as enum ('clear', 'possible_match', 'excluded');
exception when duplicate_object then null;
end $$;

create table if not exists staff.exclusion_checks (
  id          uuid primary key default gen_random_uuid(),
  org_slug    text not null references staff.orgs(slug) on delete cascade,
  user_id     uuid not null references staff.users(id) on delete cascade,
  source      staff.exclusion_source not null,
  checked_on  date not null default current_date,
  result      staff.exclusion_result not null,
  -- Required when the result is anything but clear: what was found and
  -- what was done about it. A "possible match" with no note is the same
  -- as no screen at all.
  detail      text,
  checked_by  uuid references staff.users(id),
  created_at  timestamptz not null default now()
);

do $$ begin
  alter table staff.exclusion_checks
    add constraint staff_exclusion_needs_detail
    check (result = 'clear' or (detail is not null and length(btrim(detail)) >= 3));
exception when duplicate_object then null;
end $$;

create index if not exists staff_exclusion_recent
  on staff.exclusion_checks (org_slug, user_id, checked_on desc);

alter table staff.exclusion_checks enable row level security;
alter table staff.exclusion_checks force row level security;
drop policy if exists staff_org_isolation on staff.exclusion_checks;
create policy staff_org_isolation on staff.exclusion_checks
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());
-- Append-only in practice: a screening record is evidence of what was
-- known on a date. Correcting one means recording a new screen.
grant select, insert on staff.exclusion_checks to staff_app;

-- ============================================================
-- THE ROSTER VIEW
--
-- One row per active person: what is expiring, and when they were last
-- screened. Derived on read for the same reason overdue is — a nightly
-- job that computes "expiring soon" is a job whose failure looks exactly
-- like "nothing is expiring".
-- ============================================================

drop view if exists staff.credential_status cascade;
create view staff.credential_status
with (security_invoker = true) as
select
  c.id            as credential_id,
  c.org_slug,
  u.id            as user_id,
  u.email,
  u.legal_name,
  u.role,
  u.job_role,
  c.kind,
  c.issuer,
  c.label,
  c.issued_on,
  c.expires_on,
  c.verified_on,
  (c.expires_on - current_date)                as days_left,
  case
    when c.expires_on is null                  then 'no_date'
    when c.expires_on < current_date           then 'expired'
    when c.expires_on <= current_date + 30     then 'critical'
    when c.expires_on <= current_date + 90     then 'expiring'
    else 'current'
  end                                          as status
from staff.credentials c
join staff.users u on u.id = c.user_id
where c.active and u.active;

grant select on staff.credential_status to staff_app;

-- Latest screen per person per source, and how stale it is. A person who
-- has never been screened shows up with a null date rather than being
-- absent, because "never screened" is the finding.
-- Dropped first rather than CREATE OR REPLACE: replace can only APPEND
-- columns to a view, so once a later migration extends this one, the
-- combined setup file's second run fails here with "cannot drop
-- columns from view" while its first run was clean. Drop-first makes
-- every view definition rerunnable regardless of what extends it.
drop view if exists staff.exclusion_status cascade;
create view staff.exclusion_status
with (security_invoker = true) as
select
  u.org_slug,
  u.id as user_id,
  u.email,
  u.legal_name,
  s.source,
  x.checked_on,
  x.result,
  (current_date - x.checked_on)      as days_since,
  case
    when x.checked_on is null                   then 'never'
    when x.result <> 'clear'                    then 'flagged'
    when x.checked_on < current_date - 31       then 'overdue'
    else 'current'
  end                                as status
from staff.users u
cross join (values ('oig_leie'::staff.exclusion_source),
                   ('sam_gov'::staff.exclusion_source)) as s(source)
left join lateral (
  select checked_on, result
    from staff.exclusion_checks e
   where e.user_id = u.id and e.source = s.source
   order by checked_on desc
   limit 1
) x on true
where u.active;

grant select on staff.exclusion_status to staff_app;

-- One number for the dashboard.
-- Dropped first rather than CREATE OR REPLACE: replace can only APPEND
-- columns to a view, so once a later migration extends this one, the
-- combined setup file's second run fails here with "cannot drop
-- columns from view" while its first run was clean. Drop-first makes
-- every view definition rerunnable regardless of what extends it.
drop view if exists staff.roster_risk cascade;
create view staff.roster_risk
with (security_invoker = true) as
select
  o.slug as org_slug,
  (select count(*) from staff.credential_status c
    where c.org_slug = o.slug and c.status = 'expired')::int   as expired,
  (select count(*) from staff.credential_status c
    where c.org_slug = o.slug and c.status = 'critical')::int  as expiring_30,
  (select count(*) from staff.exclusion_status e
    where e.org_slug = o.slug and e.status in ('never','overdue'))::int as screens_due,
  (select count(*) from staff.exclusion_status e
    where e.org_slug = o.slug and e.status = 'flagged')::int   as screens_flagged
from staff.orgs o;

grant select on staff.roster_risk to staff_app;


-- ========== staff-credentials-seed.sql ==========

-- ============================================================
-- THE SCREENING OBLIGATIONS
--
-- Run AFTER supabase/staff-credentials.sql. Idempotent.
--
-- Monthly, because that is the cadence the OIG's own guidance sets for
-- re-screening the exclusion list, and because a state exclusion can
-- appear between two annual checks and be missed for eleven months.
-- ============================================================

create or replace function staff.seed_screening_obligations(p_slug text)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into staff.obligations
    (org_slug, key, title, detail, category, citation, source,
     due_on, repeat_months, job_roles)
  select p_slug, d.key, d.title, d.detail, d.category, d.citation, d.source,
         current_date + d.offset_days, d.repeat_months, d.job_roles
  from (values
    ('oig-exclusion-screen',
     'OIG exclusion screening — whole roster',
     'Screen every employee, contractor and vendor against the OIG List of Excluded Individuals and Entities, and record the result against each name. A federal health care programme will not pay for any item or service furnished, ordered or prescribed by an excluded person — nor for anything an excluded person merely helped with — so this reaches the receptionist and the cleaner, not only the prescribers.',
     'Employment', '42 CFR 1001.1901', 'OIG Special Advisory Bulletin on the effect of exclusion',
     7, 1, array['center_admin']::staff.job_role[]),

    ('sam-debarment-screen',
     'SAM.gov debarment screening',
     'Screen the roster against the federal exclusions in SAM.gov. Overlaps the LEIE but is not identical: procurement debarment and health care exclusion are separate lists with separate causes.',
     'Employment', null, 'System for Award Management',
     7, 1, array['center_admin']::staff.job_role[]),

    ('credential-expiry-sweep',
     'Credential and licence expiry sweep',
     'Walk the roster: state licences, DEA registrations where applicable, BLS and ACLS cards, board certifications, malpractice coverage. Anything inside 90 days gets a renewal started, not a note.',
     'Employment', null, 'Practice standard',
     14, 1, array['center_admin']::staff.job_role[])
  ) as d(key, title, detail, category, citation, source, offset_days, repeat_months, job_roles)
  where not exists (
    select 1 from staff.obligations o
     where o.org_slug = p_slug and o.key = d.key
  );

  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function staff.seed_screening_obligations(text) to staff_app;

create or replace function staff.screening_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_screening_obligations(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_screening on staff.orgs;
create trigger staff_orgs_seed_screening
  after insert on staff.orgs
  for each row execute function staff.screening_seed_new_org();

do $$
declare o record;
begin
  for o in select slug from staff.orgs loop
    perform staff.seed_screening_obligations(o.slug);
  end loop;
end $$;


-- ========== staff-scope.sql ==========

-- ============================================================
-- SCOPE OF PRACTICE
--
-- Run AFTER supabase/staff-job-roles.sql (it needs staff.job_role).
-- Idempotent; safe to re-run.
--
-- WHAT THIS IS, AND WHY IT IS NOT A DIRECTIVE
-- -------------------------------------------
-- staff.directives holds standing rules: prose, one rule per row, read
-- and remembered. This holds something narrower and, for the people at
-- the window, more useful — the two lists that answer "is this mine?"
--
--   authorized  — this job may do this, without asking
--   prohibited  — this job may NEVER do this, however busy it is
--
-- Two lists rather than one rule per row because scope is read as a
-- comparison. Somebody covering the desk on their third shift is not
-- looking up a rule; they are looking at a column and checking whether
-- the thing in front of them is in it. Split across two dozen directives
-- that answer is not visible, which in practice means it is not read.
--
-- WHY `instead` IS A COLUMN AND NOT A NICETY
-- A prohibited item with no sanctioned alternative is a rule that gets
-- broken under pressure, because the person still has a patient in front
-- of them wanting an answer. "Never give clinical advice" is not
-- actionable at 11am with a queue; "say: let me get a clinical staff
-- member to answer that, and get one" is. Every prohibited row carries
-- the sentence to use instead, and the seed enforces it.
--
-- SEPARATION. Scope belongs to exactly one job — job_role is a single
-- value here, not the array used on tasks. A task can be shared; a scope
-- boundary cannot be, because the whole point of the row is that it
-- draws a line between one job and another.
-- ============================================================

create table if not exists staff.scope_items (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  -- Stable identifier so the seed can be re-run, and so a clinic that
  -- edits the wording of an item keeps the item.
  key text not null,

  job_role staff.job_role not null,
  kind text not null check (kind in ('authorized', 'prohibited')),

  item text not null,

  -- The sanctioned alternative. Required on prohibited rows by the
  -- constraint below; meaningless on authorized ones.
  instead text,

  -- Where the boundary comes from, when it comes from somewhere. Most of
  -- these are state scope-of-practice law or clinic policy rather than a
  -- federal citation, and a row that cites nothing is honest about being
  -- clinic policy.
  citation text,

  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists staff_scope_items_key
  on staff.scope_items (org_slug, key);

create index if not exists staff_scope_items_role
  on staff.scope_items (org_slug, job_role, kind, sort_order)
  where active;

-- A prohibition with no alternative is a rule that loses to a queue.
-- Enforced here and not only in the seed, because the clinic can add its
-- own rows and the failure mode is identical when they do.
do $$ begin
  alter table staff.scope_items
    add constraint staff_scope_prohibited_needs_alternative
    check (
      kind <> 'prohibited'
      or (instead is not null and length(btrim(instead)) >= 3)
    );
exception when duplicate_object then null;
end $$;

-- An authorized row has nothing to redirect to; a stray `instead` there
-- would render as advice on how to avoid doing your own job.
do $$ begin
  alter table staff.scope_items
    add constraint staff_scope_authorized_has_no_alternative
    check (kind <> 'authorized' or instead is null);
exception when duplicate_object then null;
end $$;

alter table staff.scope_items enable row level security;
alter table staff.scope_items force row level security;

drop policy if exists staff_org_isolation on staff.scope_items;
create policy staff_org_isolation on staff.scope_items
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.scope_items to staff_app;
-- Deactivated, never deleted: which boundaries a clinic decided did not
-- apply to it is exactly the question asked after something goes wrong.
-- staff-schema.sql's ALTER DEFAULT PRIVILEGES grants delete on every
-- future table in this schema, so this table arrived holding it and the
-- GRANT above took none of it away.
revoke delete on staff.scope_items from staff_app;

-- ============================================================
-- THE TWO COLUMNS
--
-- security_invoker so it reads under the caller's org context rather
-- than the view owner's — without it a view over an RLS-protected table
-- returns every org's rows. Same note as staff-onboarding.sql.
--
-- Dropped first rather than CREATE OR REPLACE: replace can only APPEND
-- columns to a view, so a later migration that inserts a column here
-- would make this file's SECOND run fail while its first was clean.
-- ============================================================

drop view if exists staff.scope_of_practice cascade;
create view staff.scope_of_practice
with (security_invoker = true) as
select
  s.id,
  s.org_slug,
  s.key,
  s.job_role,
  s.kind,
  s.item,
  s.instead,
  s.citation,
  s.sort_order
from staff.scope_items s
where s.active;

grant select on staff.scope_of_practice to staff_app;


-- ========== staff-scope-seed.sql ==========

-- ============================================================
-- SCOPE OF PRACTICE — seed
--
-- Run AFTER supabase/staff-scope.sql. Idempotent; safe to re-run.
--
-- PROVENANCE, because it matters more here than anywhere else in this
-- module. A scope boundary that is wrong in the permissive direction
-- tells somebody unlicensed that a clinical act is theirs to perform.
--
--   front_desk       — supplied by the operator, verbatim. These are
--                      this clinic's own authorized and prohibited
--                      duties, not a generic list.
--   medical_assistant,
--   xray_tech,
--   provider         — DRAFTED from the boundaries that are common to
--                      essentially every US state's rules for these
--                      roles: an unlicensed assistant may not assess,
--                      diagnose, interpret, or advise; an operator may
--                      not decide what to image; a provider may not
--                      delegate a judgement that requires their licence.
--                      They are deliberately the uncontroversial core.
--
-- WHAT IS NOT HERE. Anything that varies by state — whether an MA may
-- administer an immunisation, inject, or perform venipuncture, whether a
-- limited-scope operator may fluoroscope — is absent on purpose. Those
-- are real questions with different answers in different states, and a
-- confident wrong answer in this table would be worse than a gap the
-- clinic notices and fills. Add them per clinic, with the citation.
-- ============================================================

create or replace function staff.seed_scope(p_slug text)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into staff.scope_items
    (org_slug, key, job_role, kind, item, instead, citation, sort_order)
  select p_slug, d.key, d.job_role, d.kind, d.item, d.instead, d.citation, d.sort_order
  from (values

    -- ---------- FRONT DESK: authorized ----------
    ('fd-a-payments', 'front_desk'::staff.job_role, 'authorized',
     'Collecting copays, deductibles, and self-pay fees',
     null::text, null::text, 10),

    ('fd-a-eligibility', 'front_desk'::staff.job_role, 'authorized',
     'Verifying insurance RTE and employer authorization protocols',
     null, null, 20),

    ('fd-a-queue', 'front_desk'::staff.job_role, 'authorized',
     'Managing queue wait times and check-in workflows',
     null, null, 30),

    ('fd-a-ledger', 'front_desk'::staff.job_role, 'authorized',
     'Resolving billing ledger disputes at the desk or window',
     null, null, 40),

    -- ---------- FRONT DESK: strictly prohibited ----------
    --
    -- Each of these is a thing a patient will ask the desk for directly,
    -- politely, and often — which is why each carries the sentence to
    -- use instead. "No" alone loses to a full lobby.
    ('fd-p-triage', 'front_desk'::staff.job_role, 'prohibited',
     'Medical triage, clinical assessment, or symptom diagnosis',
     'Say: "Let me get a clinical staff member to look at that for you," and go get one. If the patient looks like they are deteriorating, say so out loud immediately — escalating is never the wrong call.',
     null, 50),

    ('fd-p-treatment', 'front_desk'::staff.job_role, 'prohibited',
     'Advising patients on medical treatment plans or test necessity',
     'Say: "I can''t advise on that, but I''ll have the provider or an MA answer it before you leave." Write the question down so it is actually asked.',
     null, 60),

    ('fd-p-clinical-tasks', 'front_desk'::staff.job_role, 'prohibited',
     'Handling POCT lab testing, specimen collection, or vitals',
     'Hand the task to clinical staff, even when the lobby is full and it would be faster to do it yourself. If nobody is free, tell the patient there is a wait — do not start it.',
     null, 70),

    ('fd-p-findings', 'front_desk'::staff.job_role, 'prohibited',
     'Discussing clinical findings or provider notes',
     'Say: "Those results need to come from a clinician — let me arrange that." Do not read a result off a screen, confirm one, or say whether it looked normal.',
     null, 80),

    -- ---------- MEDICAL ASSISTANT ----------
    ('ma-a-vitals', 'medical_assistant'::staff.job_role, 'authorized',
     'Vitals, point-of-care testing, and specimen collection under the provider''s order',
     null, null, 110),

    ('ma-a-rooming', 'medical_assistant'::staff.job_role, 'authorized',
     'Rooming, recording the patient''s own account of why they came, and preparing the room',
     null, null, 120),

    ('ma-a-stock', 'medical_assistant'::staff.job_role, 'authorized',
     'Vaccine and medication stock handling: temperature logs, beyond-use dating, quarantine of out-of-range stock',
     null, null, 130),

    ('ma-a-relay', 'medical_assistant'::staff.job_role, 'authorized',
     'Relaying instructions the provider has already given, in the provider''s words',
     null, null, 140),

    ('ma-p-triage', 'medical_assistant'::staff.job_role, 'prohibited',
     'Deciding how urgent a patient is, or telling a patient they do not need to be seen',
     'Record what the patient says and escalate to a provider or the clinical lead. Recording "chest pain since 6am" is yours; deciding what it means is not.',
     null, 150),

    ('ma-p-interpret', 'medical_assistant'::staff.job_role, 'prohibited',
     'Interpreting a result, an image, or a reading for a patient',
     'Say: "The provider will go over those with you." Report the number to the provider — never a conclusion about it.',
     null, 160),

    ('ma-p-phone-advice', 'medical_assistant'::staff.job_role, 'prohibited',
     'Giving clinical advice by phone, including whether to come in',
     'Take the message and route it to a clinician the same day. If it sounds like an emergency, tell the caller to hang up and call 911.',
     null, 170),

    ('ma-p-unordered', 'medical_assistant'::staff.job_role, 'prohibited',
     'Performing or reporting anything not ordered by a provider',
     'Ask for the order. An order given verbally is fine and is documented as verbal — an assumed order is not an order.',
     null, 180),

    -- ---------- X-RAY TECH ----------
    ('xr-a-perform', 'xray_tech'::staff.job_role, 'authorized',
     'Performing the ordered radiographic exam and positioning the patient',
     null, null, 210),

    ('xr-a-technique', 'xray_tech'::staff.job_role, 'authorized',
     'Selecting technique and shielding to keep dose as low as reasonably achievable',
     null, null, 220),

    ('xr-a-equipment', 'xray_tech'::staff.job_role, 'authorized',
     'Equipment and lead-apron checks, and taking defective shielding out of service',
     null, null, 230),

    ('xr-a-repeats', 'xray_tech'::staff.job_role, 'authorized',
     'Recording repeat exposures and the reason for each',
     null, null, 240),

    ('xr-p-interpret', 'xray_tech'::staff.job_role, 'prohibited',
     'Reading the image for the patient, or saying whether anything is broken',
     'Say: "The provider reads these — they''ll come talk to you." Nothing about the image, including a reassuring nothing.',
     null, 250),

    ('xr-p-unordered-view', 'xray_tech'::staff.job_role, 'prohibited',
     'Adding, substituting, or skipping a view without the ordering provider',
     'Call the provider and get the order changed. A clinically sensible extra view is still an unordered exposure until they say so.',
     null, 260),

    ('xr-p-pregnancy', 'xray_tech'::staff.job_role, 'prohibited',
     'Proceeding when pregnancy is possible and unconfirmed, on your own judgement',
     'Stop and get the provider. The decision to image anyway is a clinical one and it is documented as such.',
     null, 270),

    -- ---------- PROVIDER ----------
    ('pr-a-diagnose', 'provider'::staff.job_role, 'authorized',
     'Assessment, diagnosis, orders, prescribing, and the disposition decision',
     null, null, 310),

    ('pr-a-delegate', 'provider'::staff.job_role, 'authorized',
     'Delegating tasks within each staff member''s own scope, by order',
     null, null, 320),

    ('pr-a-overread', 'provider'::staff.job_role, 'authorized',
     'Preliminary reads, and closing the loop when the over-read differs',
     null, null, 330),

    ('pr-p-delegate-judgement', 'provider'::staff.job_role, 'prohibited',
     'Delegating a judgement that requires your licence — triage decisions, result interpretation, disposition',
     'Delegate the task, keep the judgement. "Get a repeat BP" is a task; "tell them if it is fine" is not.',
     null, 340),

    ('pr-p-retro-cosign', 'provider'::staff.job_role, 'prohibited',
     'Signing for anything you did not personally witness — controlled-substance waste above all',
     'Witness it in real time or do not sign it. A co-signature added afterwards attests to something the signer did not see, which is the specific thing a diversion investigation looks for.',
     null, 350),

    ('pr-p-chart-edit', 'provider'::staff.job_role, 'prohibited',
     'Changing a note after the fact without it being visible as an addendum',
     'Add an addendum with its own timestamp. A silently edited note discredits the whole chart, including the parts that were right.',
     null, 360)

  ) as d(key, job_role, kind, item, instead, citation, sort_order)
  where not exists (
    select 1 from staff.scope_items x
     where x.org_slug = p_slug and x.key = d.key
  );

  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function staff.seed_scope(text) to staff_app;

-- New orgs get the scope on creation, the same way they get directives.
create or replace function staff.scope_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_scope(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_scope on staff.orgs;
create trigger staff_orgs_seed_scope
  after insert on staff.orgs
  for each row execute function staff.scope_seed_new_org();

-- And every org that already exists.
do $$
declare o record;
begin
  for o in select slug from staff.orgs loop
    perform staff.seed_scope(o.slug);
  end loop;
end $$;


-- ========== staff-rounds.sql ==========

-- ============================================================
-- ROUNDS — guided runbooks, walked one step at a time
--
-- Run AFTER supabase/staff-job-roles.sql. Idempotent; safe to re-run.
--
-- WHY THIS IS NOT A FORM, AND NOT A CHECKLIST
-- -------------------------------------------
-- staff.form_templates already holds per-shift tasks with fields and
-- thresholds — the fridge reading, the crash cart seal. Those are
-- measurements, and a measurement needs a box to write the number in.
--
-- A round is the other thing: a physical walk with a fixed order.
-- Restrooms, hydration station, lobby seating, mask station, kiosk. The
-- record that matters is that ONE PERSON walked ALL of it at a stated
-- time, not that fourteen boxes each acquired a tick.
--
-- AND A CHECKLIST OF BOXES IS WORSE THAN NOTHING HERE. Fourteen
-- checkboxes on one screen get ticked top to bottom at the counter
-- without anybody leaving the desk — the form is satisfiable without the
-- walk, which makes the record a lie that looks like evidence. Presented
-- one step at a time, with the next step hidden until the current one is
-- passed, the fastest way through is to actually walk it.
--
-- SO: there is NO per-step stored outcome. A run has a start, an end, a
-- person, and one attestation covering the whole round — the same shape
-- as the paper round sheet it replaces, where you initial the bottom and
-- not each line.
--
-- WHAT SAVES IT FROM BEING A RUBBER STAMP is staff.round_runs.exceptions:
-- any step can have a problem reported against it as you pass through,
-- and that note is the part a manager reads. A round with no exceptions
-- ever recorded is not a clean lobby, it is a round nobody is really
-- walking, and the exception count is what makes that visible.
-- ============================================================

create table if not exists staff.rounds (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  key text not null,

  -- Which job walks this. Same array shape as form_templates so the
  -- brief filters both with staff.brief_matches().
  job_roles staff.job_role[] not null default '{}',

  title text not null,
  -- One line, imperative, shown under the title on the list.
  purpose text,

  -- When it is walked. Free text rather than an enum because clinics
  -- genuinely differ: "every hour", "at open", "at close", "when it
  -- happens". The app groups by this string and does not compute from it.
  cadence text not null default 'as needed',

  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists staff_rounds_key
  on staff.rounds (org_slug, key);

create table if not exists staff.round_steps (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references staff.rounds(id) on delete cascade,
  step_no integer not null,

  -- The instruction. Imperative, one action, no preamble — this is read
  -- standing up with something in the other hand.
  instruction text not null,
  -- The detail that stops it being ambiguous, when there is one.
  detail text,

  created_at timestamptz not null default now()
);

create unique index if not exists staff_round_steps_order
  on staff.round_steps (round_id, step_no);

-- ============================================================
-- A COMPLETED PASS
--
-- started_at is set when the person opens step 1, completed_at when they
-- attest at the end. The gap between them is the only honest signal the
-- system has about whether the walk happened: a fourteen-step lobby
-- round attested four seconds after it started did not.
-- ============================================================

create table if not exists staff.round_runs (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  round_id uuid not null references staff.rounds(id) on delete cascade,

  walked_by uuid not null references staff.users(id),
  started_at timestamptz not null,
  completed_at timestamptz not null default now(),

  -- Problems found on the way round: [{step_no, note}]. Empty is a valid
  -- and common answer; it is the ALL-empty history that means something.
  exceptions jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists staff_round_runs_recent
  on staff.round_runs (org_slug, round_id, completed_at desc);

-- A run that finishes before it starts is a clock problem or a forged
-- record, and either way it should not be storable.
do $$ begin
  alter table staff.round_runs
    add constraint staff_round_run_ordered
    check (completed_at >= started_at);
exception when duplicate_object then null;
end $$;

-- Exceptions have to be a list of objects, not whatever the caller sent.
do $$ begin
  alter table staff.round_runs
    add constraint staff_round_run_exceptions_shape
    check (jsonb_typeof(exceptions) = 'array');
exception when duplicate_object then null;
end $$;

-- ============================================================
-- ROW-LEVEL SECURITY
-- Same shape as every other org-scoped table. See staff-schema.sql.
-- round_steps has no org column of its own; it is reached only through
-- its round, so it is protected by a policy that joins back to one.
-- ============================================================

alter table staff.rounds enable row level security;
alter table staff.rounds force row level security;
drop policy if exists staff_org_isolation on staff.rounds;
create policy staff_org_isolation on staff.rounds
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

alter table staff.round_steps enable row level security;
alter table staff.round_steps force row level security;
drop policy if exists staff_org_isolation on staff.round_steps;
create policy staff_org_isolation on staff.round_steps
  for all
  using (exists (
    select 1 from staff.rounds r
     where r.id = round_steps.round_id
       and (staff.is_super_admin() or r.org_slug = staff.current_org())
  ))
  with check (exists (
    select 1 from staff.rounds r
     where r.id = round_steps.round_id
       and (staff.is_super_admin() or r.org_slug = staff.current_org())
  ));

alter table staff.round_runs enable row level security;
alter table staff.round_runs force row level security;
drop policy if exists staff_org_isolation on staff.round_runs;
create policy staff_org_isolation on staff.round_runs
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.rounds to staff_app;
grant select, insert, update on staff.round_steps to staff_app;
-- Runs are INSERT-ONLY. A completed round is a signed record of where
-- somebody was and when; letting it be edited afterwards would make the
-- timestamp — the only thing that makes the record worth keeping —
-- rewritable. No update grant, and no delete.
grant select, insert on staff.round_runs to staff_app;
revoke delete on staff.rounds from staff_app;
revoke delete on staff.round_steps from staff_app;
revoke update, delete on staff.round_runs from staff_app;

-- ============================================================
-- THE LIST, WITH ITS LAST PASS
--
-- security_invoker so it reads under the caller's org context rather
-- than the view owner's. Dropped first rather than CREATE OR REPLACE:
-- replace can only APPEND columns to a view, so a later migration that
-- inserts a column would break this file's second run.
-- ============================================================

drop view if exists staff.round_board cascade;
create view staff.round_board
with (security_invoker = true) as
select
  r.id,
  r.org_slug,
  r.key,
  r.job_roles,
  r.title,
  r.purpose,
  r.cadence,
  r.sort_order,
  (select count(*) from staff.round_steps s where s.round_id = r.id)::int
    as step_count,
  last_run.completed_at as last_walked_at,
  last_run.walker       as last_walked_by,
  jsonb_array_length(coalesce(last_run.exceptions, '[]'::jsonb))::int
    as last_exception_count
from staff.rounds r
left join lateral (
  select ru.completed_at, ru.exceptions, u.legal_name as walker
    from staff.round_runs ru
    left join staff.users u on u.id = ru.walked_by
   where ru.round_id = r.id
   order by ru.completed_at desc
   limit 1
) last_run on true
where r.active;

grant select on staff.round_board to staff_app;


-- ========== staff-rounds-seed.sql ==========

-- ============================================================
-- ROUNDS — seed
--
-- Run AFTER supabase/staff-rounds.sql. Idempotent; safe to re-run.
--
-- FIVE FRONT-DESK ROUNDS, grouped by when they are walked rather than by
-- subject: hourly, at open, at close, and the two that are triggered by
-- something happening. That is the grouping the person uses. A round
-- filed under "infection control" is a round nobody opens at 2pm.
--
-- HOUSE STYLE FOR A STEP. One action, imperative, no preamble, no
-- explanation of why unless the why changes what you do. "Wipe the
-- signature pad" — not "Ensure that signature pads are being sanitized
-- between patient uses." Read standing up, with something in the other
-- hand. The detail line exists only where the instruction alone is
-- ambiguous, and it is a fragment, not a paragraph.
--
-- ORDER IS THE WALK, NOT THE TOPIC. Steps run front door inward and back
-- out, so following them in order is a single loop rather than four trips
-- past the same chair.
-- ============================================================

create or replace function staff.seed_rounds(p_slug text)
returns integer language plpgsql as $$
declare
  n integer := 0;
  r record;
  rid uuid;
begin
  -- ---------- the rounds ----------
  insert into staff.rounds (org_slug, key, job_roles, title, purpose, cadence, sort_order)
  select p_slug, d.key, array['front_desk']::staff.job_role[],
         d.title, d.purpose, d.cadence, d.sort_order
  from (values
    ('fd-hourly-lobby',
     'Hourly lobby round',
     'Restrooms, seating, kiosks, stock. One loop, front door and back.',
     'every hour', 10),
    ('fd-open',
     'Opening the front of house',
     'Doors, alarms, screens, drawer. Before the first patient.',
     'at open', 20),
    ('fd-close',
     'Closing the front of house',
     'Drawer, terminals, doors, mail. After the last patient.',
     'at close', 30),
    ('fd-spill',
     'Spill in the lobby',
     'Isolate first. Body fluids are never yours to clean.',
     'when it happens', 40),
    ('fd-deteriorating',
     'Patient in the lobby looks worse',
     'Do not assess. Get clinical staff now.',
     'when it happens', 50)
  ) as d(key, title, purpose, cadence, sort_order)
  where not exists (
    select 1 from staff.rounds x where x.org_slug = p_slug and x.key = d.key
  );
  get diagnostics n = row_count;

  -- ---------- the steps ----------
  --
  -- Inserted per round and only when that round has none, so re-running
  -- neither duplicates steps nor overwrites a clinic's edits.
  for r in select id, key from staff.rounds where org_slug = p_slug loop
    rid := r.id;
    if exists (select 1 from staff.round_steps s where s.round_id = rid) then
      continue;
    end if;

    if r.key = 'fd-hourly-lobby' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (rid, 1,  'Look at the waiting room before you touch anything.',
                  'Anyone pale, sweating, breathing hard, or slumped — stop this round and get clinical staff.'),
        (rid, 2,  'Restock the door station.', 'Masks, hand sanitiser, tissues.'),
        (rid, 3,  'Wipe the check-in counter, both kiosks, and the signature pad.',
                  'EPA-registered wipes. Let the surface stay wet the full contact time on the canister.'),
        (rid, 4,  'Reset the pen bins.', 'Used bin emptied and wiped, sanitised bin refilled. Never one bin.'),
        (rid, 5,  'Restock the counter.', 'Intake forms, HIPAA notices, visitor badges, receipt paper.'),
        (rid, 6,  'Wipe chair arms and the door handles between the lobby and the desk.', null),
        (rid, 7,  'Clear the lobby.', 'Tissues, masks, cups, magazines off the floor and seats.'),
        (rid, 8,  'Empty any lobby bin that is more than three-quarters full.',
                  'Do not wait for it to overflow — it is a full bin patients photograph.'),
        (rid, 9,  'Check both public restrooms.',
                  'Soap, paper towels, toilet paper, bin. Wet floor or worse: stop and report it on this step.'),
        (rid, 10, 'Check the water station.', 'Cups stocked, counter dry, no leak under the dispenser.'),
        (rid, 11, 'Check temperature, lighting, and the screens.',
                  'Every bulb working. Screens on approved content — never news, never a personal account.'),
        (rid, 12, 'Walk the entryway outside.', 'Litter, ice, standing water, anything somebody trips on.');

    elsif r.key = 'fd-open' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (rid, 1, 'Disarm the alarm.', null),
        (rid, 2, 'Walk the exterior entry before you unlock.',
                 'Ice, water, litter, damage, anything left overnight at the door.'),
        (rid, 3, 'Unlock the exterior doors.', null),
        (rid, 4, 'Power on both intake kiosks and the waiting-room screens.',
                 'Confirm the screens land on approved content, not a desktop.'),
        (rid, 5, 'Count the opening cash drawer and record the float.', null),
        (rid, 6, 'Confirm the card terminal connects.', 'Run a test connection, not a test charge.'),
        (rid, 7, 'Stock the counter and the door station for the morning.',
                 'Forms, notices, badges, receipt paper, masks, sanitiser.'),
        (rid, 8, 'Walk the hourly lobby round once before the doors see a patient.', null);

    elsif r.key = 'fd-close' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (rid, 1, 'Confirm the last patient has left the lobby and the restrooms.',
                 'Look. Do not assume.'),
        (rid, 2, 'Balance the drawer and reconcile the day''s ledger.',
                 'A variance is reported tonight, not carried to tomorrow.'),
        (rid, 3, 'Settle and secure the card terminal.', null),
        (rid, 4, 'Secure the drawer per clinic policy.', null),
        (rid, 5, 'Secure incoming mail and packages out of the lobby.',
                 'Nothing with a patient name on it left on the counter overnight.'),
        (rid, 6, 'Power down kiosks and screens.', null),
        (rid, 7, 'Clear and wipe the lobby and the counter.', null),
        (rid, 8, 'Lock the exterior doors.', null),
        (rid, 9, 'Arm the alarm and confirm it set.', null);

    elsif r.key = 'fd-spill' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (rid, 1, 'Stand where nobody can walk into it and keep people back.',
                 'You are the barrier until there is a real one.'),
        (rid, 2, 'Decide what it is.',
                 'Blood, vomit, urine, or anything you are unsure about is a body fluid. Water and coffee are not.'),
        (rid, 3, 'Body fluid: call environmental services or clinical staff now. Do not clean it.',
                 'Spill kit and PPE, by someone trained in it. This is not a front-desk task.'),
        (rid, 4, 'Water or drink: put the wet-floor sign out, then mop it.', null),
        (rid, 5, 'Stay until the area is dry or handed over.',
                 'A sign on a wet floor with nobody watching it is not control of the hazard.');

    elsif r.key = 'fd-deteriorating' then
      insert into staff.round_steps (round_id, step_no, instruction, detail) values
        (rid, 1, 'Say it out loud to clinical staff now.',
                 'Describe what you see — pale, sweating, short of breath, slumped. Do not interpret it.'),
        (rid, 2, 'Stay with the patient until clinical staff arrive.', null),
        (rid, 3, 'Do not take vitals, assess, or advise.',
                 'Watching and reporting is your job here and it is the part that matters.'),
        (rid, 4, 'If they collapse or stop responding, call for help and start the emergency response.',
                 'Anyone can call a code. You will never be criticised for calling one that turned out to be nothing.'),
        (rid, 5, 'Clear a path from the lobby to the treatment area.', null);
    end if;
  end loop;

  return n;
end $$;

grant execute on function staff.seed_rounds(text) to staff_app;

create or replace function staff.rounds_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_rounds(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_rounds on staff.orgs;
create trigger staff_orgs_seed_rounds
  after insert on staff.orgs
  for each row execute function staff.rounds_seed_new_org();

do $$
declare o record;
begin
  for o in select slug from staff.orgs loop
    perform staff.seed_rounds(o.slug);
  end loop;
end $$;


-- ========== staff-onboarding-wizard.sql ==========

-- ============================================================
-- ONBOARDING: THE JOB, THE PHONE, AND THE CREDENTIALS
--
-- Run AFTER supabase/staff-credentials.sql and staff-job-roles.sql.
-- Idempotent; safe to re-run.
--
-- WHAT WAS MISSING, AND WHY IT MATTERED
-- -------------------------------------
-- Onboarding already collected a legal name, e-sign consent, and a
-- signature per policy document, with the document's hash, the IP and
-- the user agent stored against each one. That half was fine.
--
-- Three things were not collected, and each left a hole somewhere else
-- in the product:
--
--   THE JOB. staff.users.job_role stayed null until an administrator set
--   it by hand, which meant a new hire finished onboarding and landed on
--   a board showing almost nothing — strict separation working exactly
--   as designed and looking exactly like a broken app. The job belongs
--   on the INVITE, decided by whoever invited them.
--
--   THE CREDENTIALS. staff.credentials existed and nothing ever wrote to
--   it during onboarding, so the roster's expiry tracking started life
--   empty for every new hire and only became true if somebody
--   remembered to backfill it.
--
--   A PHONE NUMBER. There was no way to reach the person the roster says
--   is responsible for something.
--
-- WHAT IS DELIBERATELY NOT ADDED HERE
-- -----------------------------------
-- No date of birth, no SSN, no DEA number, no licence number, no
-- certificate number of any kind. Expiry DATES only. This is the same
-- refusal as staff-credentials.sql and for the same reason: a licence
-- number is worth stealing and an expiry date is not, and every question
-- this product actually answers ("is anyone working expired?") is
-- answerable from the date alone.
--
-- AND THE STAFF MEMBER DOES NOT PICK THEIR OWN JOB. The wizard shows
-- them the job the invite assigned and asks them to confirm it. Letting
-- somebody self-select "Provider" on their first screen would defeat the
-- entire separation model at the one moment nobody is watching. If it is
-- wrong they say so and it stops there — an administrator fixes the
-- invite. That is a slower path and it is the correct one.
-- ============================================================

-- The job travels on the invite, so it is decided by the person doing
-- the inviting and is already true before the new hire ever signs in.
alter table staff.org_invites
  add column if not exists job_role staff.job_role;

-- Optional pre-fill. Google gives a display name, which is frequently
-- not the name that belongs on a signed record ("Dee" for "Deirdre
-- O'Connell"). An inviter who knows the legal name can put it here.
alter table staff.org_invites
  add column if not exists legal_name text;

alter table staff.users
  add column if not exists phone text;

-- Set when the person finishes the wizard: the job confirmed, the
-- credentials their job requires entered, and every assigned document
-- signed.
--
-- STORED, UNLIKE ALMOST EVERYTHING ELSE IN THIS MODULE, and the
-- exception needs justifying. Overdue and expired are derived because
-- deriving them cannot go stale. This cannot be derived the same way:
-- "has seen the orientation" is a fact about a person's attention, and
-- there is nothing in the database to compute it from. Every other gate
-- in the wizard IS still derived — the profile, the job, the
-- credentials, the documents are all recomputed per request — so this
-- column gates one screen and cannot make anything else look done.
alter table staff.users
  add column if not exists onboarded_at timestamptz;

-- When the person read and confirmed the job on their invite.
--
-- SEPARATE FROM job_role BEING SET, and the distinction is the whole
-- reason the step exists. "Has a job" is a fact about the invite;
-- "confirmed the job" is a fact about the person having read which side
-- of the scope-of-practice line they are on. Gating on job_role alone
-- skipped the step entirely for every properly-invited hire — which is
-- everyone the step was written for.
alter table staff.users
  add column if not exists job_confirmed_at timestamptz;

comment on column staff.users.onboarded_at is
  'When the orientation was acknowledged. Gates the orientation screen only; every other onboarding step is derived per request.';

-- ============================================================
-- WHICH CREDENTIALS A JOB HAS TO HAVE
--
-- A table, not a CASE in TypeScript, so the roster's "who is missing
-- what" question and the wizard's "what do I ask this person for"
-- question are answered from one place. A clinic that needs ACLS from
-- its providers adds a row; it does not need a deploy.
-- ============================================================

create table if not exists staff.job_credential_requirements (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  job_role staff.job_role not null,
  kind staff.credential_kind not null,

  -- False for a credential that is tracked when present but does not
  -- block onboarding — a provider's board certification, say.
  required boolean not null default true,

  -- Shown next to the date field. Without it the field says
  -- "bls_cpr" at somebody on their first morning.
  label text not null,
  -- One line under the field, where the field alone is ambiguous.
  hint text,

  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists staff_job_cred_req_key
  on staff.job_credential_requirements (org_slug, job_role, kind);

alter table staff.job_credential_requirements enable row level security;
alter table staff.job_credential_requirements force row level security;
drop policy if exists staff_org_isolation on staff.job_credential_requirements;
create policy staff_org_isolation on staff.job_credential_requirements
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.job_credential_requirements to staff_app;
revoke delete on staff.job_credential_requirements from staff_app;

-- ============================================================
-- WHAT IS LEFT TO DO
--
-- One row per user, recomputed on read. The wizard renders the first
-- unfinished step rather than tracking a step number, so a refresh, the
-- back button, a second tab and a phone that slept mid-signature all
-- behave correctly without any of them being handled — the same
-- reasoning as the existing document loop, extended to the new steps.
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first rather than CREATE OR REPLACE, so a later migration that inserts
-- a column cannot break this file's second run.
-- ============================================================

drop view if exists staff.onboarding_state cascade;
create view staff.onboarding_state
with (security_invoker = true) as
select
  u.id as user_id,
  u.org_slug,
  u.job_role,
  u.onboarded_at,

  (u.legal_name is null or u.esign_consented_at is null) as needs_profile,
  (u.job_role is null or u.job_confirmed_at is null)     as needs_job,
  -- Distinguishes "nobody told us what you do" from "you have not read
  -- it yet". The first is an administrator's problem and the wizard
  -- says so; the second is one tap.
  (u.job_role is null)                                   as job_unassigned,

  -- Required credentials for this job with no active row carrying an
  -- expiry date. Empty for a job with no requirements, and empty for a
  -- person with no job — who is stopped at needs_job anyway.
  coalesce(missing.kinds, '{}')                          as missing_credentials,

  coalesce(docs.outstanding, 0)                          as outstanding_docs,
  (u.onboarded_at is null)                               as needs_orientation
from staff.users u
left join lateral (
  select array_agg(req.kind::text order by req.sort_order) as kinds
    from staff.job_credential_requirements req
   where req.org_slug = u.org_slug
     and req.job_role = u.job_role
     and req.active
     and req.required
     and not exists (
       select 1 from staff.credentials c
        where c.user_id = u.id
          and c.kind = req.kind
          and c.active
          and c.expires_on is not null
     )
) missing on true
left join lateral (
  select count(*)::int as outstanding
    from staff.outstanding_docs od
   where od.user_id = u.id
) docs on true;

grant select on staff.onboarding_state to staff_app;


-- ========== staff-onboarding-wizard-seed.sql ==========

-- ============================================================
-- WHICH CREDENTIALS EACH JOB HAS TO HAVE — seed
--
-- Run AFTER supabase/staff-onboarding-wizard.sql. Idempotent.
--
-- REQUIRED means "onboarding stops here until there is a date". That is
-- a strong claim, so it is used only where working without the thing is
-- indefensible rather than merely untidy:
--
--   BLS/CPR for everyone who touches a patient. Front desk is included
--   deliberately — the person nearest the lobby is the person nearest a
--   collapse, and the front-desk scope of practice already tells them to
--   escalate rather than assess, which is a great deal easier to do
--   usefully with current BLS.
--
--   ARRT for x-ray techs and a state medical licence for providers.
--   Operating imaging equipment or practising medicine without a current
--   one is not a paperwork problem.
--
-- Everything else is tracked but not required: it appears in the wizard
-- with a date field somebody can leave blank, and on the roster once
-- filled. ACLS/PALS are not universally held in urgent care and blocking
-- on them would teach people to type a date they do not have.
--
-- DATES ONLY, NEVER NUMBERS. No licence number, no ARRT number, no DEA.
-- See the header of staff-credentials.sql.
-- ============================================================

create or replace function staff.seed_job_credential_requirements(p_slug text)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into staff.job_credential_requirements
    (org_slug, job_role, kind, required, label, hint, sort_order)
  select p_slug, d.job_role, d.kind, d.required, d.label, d.hint, d.sort_order
  from (values
    -- Everyone who works a shift
    ('front_desk'::staff.job_role,        'bls_cpr'::staff.credential_kind, true,
     'BLS / CPR expires', 'The date on the card, not the date you took it.', 10),
    ('medical_assistant'::staff.job_role, 'bls_cpr'::staff.credential_kind, true,
     'BLS / CPR expires', 'The date on the card, not the date you took it.', 10),
    ('xray_tech'::staff.job_role,         'bls_cpr'::staff.credential_kind, true,
     'BLS / CPR expires', 'The date on the card, not the date you took it.', 10),
    ('provider'::staff.job_role,          'bls_cpr'::staff.credential_kind, true,
     'BLS / CPR expires', 'The date on the card, not the date you took it.', 10),
    ('center_admin'::staff.job_role,      'bls_cpr'::staff.credential_kind, false,
     'BLS / CPR expires', 'If you hold one.', 10),

    -- X-ray
    ('xray_tech'::staff.job_role, 'arrt'::staff.credential_kind, true,
     'ARRT or state operator permit expires',
     'Whichever your state issues you to operate under.', 20),

    -- Providers
    ('provider'::staff.job_role, 'state_license'::staff.credential_kind, true,
     'State medical licence expires', null, 20),
    ('provider'::staff.job_role, 'board_certification'::staff.credential_kind, false,
     'Board certification expires', 'Leave blank if it does not expire.', 30),
    ('provider'::staff.job_role, 'acls'::staff.credential_kind, false,
     'ACLS expires', 'If you hold one.', 40),
    ('provider'::staff.job_role, 'pals'::staff.credential_kind, false,
     'PALS expires', 'If you hold one.', 50),
    ('provider'::staff.job_role, 'malpractice'::staff.credential_kind, false,
     'Malpractice cover expires', 'The policy period end date.', 60),

    -- Clinical staff who may hold more
    ('medical_assistant'::staff.job_role, 'acls'::staff.credential_kind, false,
     'ACLS expires', 'If you hold one.', 30)
  ) as d(job_role, kind, required, label, hint, sort_order)
  where not exists (
    select 1 from staff.job_credential_requirements x
     where x.org_slug = p_slug
       and x.job_role = d.job_role
       and x.kind = d.kind
  );

  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function staff.seed_job_credential_requirements(text) to staff_app;

create or replace function staff.job_cred_req_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_job_credential_requirements(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_job_cred_req on staff.orgs;
create trigger staff_orgs_seed_job_cred_req
  after insert on staff.orgs
  for each row execute function staff.job_cred_req_seed_new_org();

do $$
declare o record;
begin
  for o in select slug from staff.orgs loop
    perform staff.seed_job_credential_requirements(o.slug);
  end loop;
end $$;


-- ========== staff-documents.sql ==========

-- ============================================================
-- THE PERSONAL DOCUMENT VAULT
--
-- Run AFTER supabase/staff-credentials.sql. Idempotent.
--
-- WHAT THIS IS FOR
-- ----------------
-- staff.credentials answers the ORGANISATION's question: is anybody on
-- this roster working expired. It is read on the roster page by clinical
-- leads and administrators, and until now it was the only place a
-- credential could live — which meant the only way a BLS card got on
-- file was somebody senior typing it in.
--
-- This is the same fact from the other end: MY cards, MY licence, MY CME
-- proofs, maintained by me. One person's shelf rather than the clinic's
-- filing cabinet, and the thing that finally lets the roster be accurate
-- without an administrator doing data entry for twenty people.
--
-- ONE FACT, NOT TWO. A document that carries an expiry date UPDATES the
-- matching staff.credentials row rather than storing a second copy of
-- the date. Two independent copies of "when does your BLS expire" is two
-- answers to one question, and the roster would be reading whichever one
-- nobody was maintaining.
--
-- A NOTE ON THE FILE ITSELF. file_path is a key in object storage, never
-- the bytes. Postgres is not a file server, and a scanned licence in a
-- table column is a row nobody can back up cheaply and a payload every
-- query planner has to step over.
--
-- AND IT IS NULLABLE, deliberately. A person can record "my BLS expires
-- in March" without having a scan to hand, and that is worth far more
-- than nothing: the roster can chase an expiry it knows about. Requiring
-- a file to record a date would mean the dates that matter most — the
-- ones belonging to people who have not got round to scanning anything —
-- are exactly the ones missing.
-- ============================================================

create table if not exists staff.user_documents (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  user_id uuid not null references staff.users(id) on delete cascade,

  -- Wider than staff.credential_kind on purpose: a CME log and a peer
  -- review are documents somebody keeps, and neither is a credential
  -- with an issuer and an expiry.
  doc_type text not null check (doc_type in (
    'bls_cpr', 'state_license', 'arrt_permit', 'board_certification',
    'malpractice', 'cme_log', 'peer_review',
    'tb_screening', 'hepatitis_b_vaccination', 'other'
  )),

  title text not null,

  -- The credential this proves, when it proves one. Set by the app so a
  -- BLS card and the BLS row on the roster are the same fact.
  credential_id uuid references staff.credentials(id) on delete set null,

  -- Object-storage key. Null while somebody has recorded the date but
  -- not yet uploaded the scan.
  file_path text,
  file_type text,
  file_bytes integer check (file_bytes is null or file_bytes > 0),

  expires_on date,

  -- Whether anyone senior has actually looked at it. Defaults to
  -- unverified, NOT verified: a self-uploaded document that the system
  -- calls "verified" the instant it lands is a system asserting
  -- something nobody checked, and on the one screen where that assertion
  -- gets shown to a surveyor.
  verified_on date,
  verified_by uuid references staff.users(id),

  active boolean not null default true,
  uploaded_at timestamptz not null default now()
);

create index if not exists staff_user_documents_mine
  on staff.user_documents (org_slug, user_id, doc_type)
  where active;

create index if not exists staff_user_documents_expiry
  on staff.user_documents (org_slug, expires_on)
  where active and expires_on is not null;

-- Verified by whom, on what day — both or neither. A verification date
-- with nobody's name on it is not a verification.
do $$ begin
  alter table staff.user_documents
    add constraint staff_user_doc_verification_complete
    check ((verified_on is null) = (verified_by is null));
exception when duplicate_object then null;
end $$;

-- A row that is neither a date nor a file is an empty row.
do $$ begin
  alter table staff.user_documents
    add constraint staff_user_doc_has_content
    check (file_path is not null or expires_on is not null);
exception when duplicate_object then null;
end $$;

alter table staff.user_documents enable row level security;
alter table staff.user_documents force row level security;

drop policy if exists staff_org_isolation on staff.user_documents;
create policy staff_org_isolation on staff.user_documents
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

-- ORG-SCOPED, NOT USER-SCOPED, AND THAT IS NOT AN OVERSIGHT. There is
-- one database role for the whole application and the session's user id
-- is not available to RLS — see staff.current_org() in staff-schema.sql,
-- which is set per connection from the signed session cookie. Per-user
-- isolation is enforced in the query layer, which is where every other
-- per-user rule in this module already lives.
--
-- The practical consequence, stated plainly: a bug in a route that omits
-- `where user_id = me` would show one person another person's documents
-- inside the same clinic. It would not cross clinics — that is what this
-- policy guarantees. lib/staff/documents.ts takes the user id as a
-- required argument for exactly this reason.
grant select, insert, update on staff.user_documents to staff_app;
revoke delete on staff.user_documents from staff_app;

-- ============================================================
-- MY SHELF
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break the second
-- run of the combined setup file.
-- ============================================================

drop view if exists staff.my_documents cascade;
create view staff.my_documents
with (security_invoker = true) as
select
  d.id,
  d.org_slug,
  d.user_id,
  d.doc_type,
  d.title,
  d.credential_id,
  d.file_path,
  d.file_type,
  d.file_bytes,
  d.expires_on,
  d.verified_on,
  v.legal_name as verified_by_name,
  d.uploaded_at,
  (d.file_path is not null) as has_file,
  -- Derived on read, like every other expiry in this module. A nightly
  -- job that marks things expired is a job whose failure looks exactly
  -- like "nothing is expired".
  case
    when d.expires_on is null                     then 'no_date'
    when d.expires_on < current_date              then 'expired'
    when d.expires_on <= current_date + 60        then 'expiring'
    else 'current'
  end as status,
  (d.expires_on - current_date) as days_left
from staff.user_documents d
left join staff.users v on v.id = d.verified_by
where d.active;

grant select on staff.my_documents to staff_app;


-- ========== staff-credential-kinds-hr.sql ==========

-- ============================================================
-- TWO MORE CREDENTIAL KINDS: TB SCREENING, HEPATITIS B
--
-- Run AFTER supabase/staff-credentials.sql and staff-documents.sql. Idempotent.
--
-- ACHC's Ambulatory Care standards (AC4-2B, AC4-2C) ask every clinic to
-- track a baseline TB screening and Hepatitis B vaccination status (or a
-- signed declination) for direct-care personnel, the same way this
-- roster already tracks BLS/CPR and a state licence. Neither existed as
-- a credential kind before this file.
--
-- ONE FILE, NOTHING REFERENCES THE NEW VALUES. Postgres will not let a
-- freshly added enum value be used in the same transaction that added
-- it, and a multi-statement paste runs as one transaction — see
-- staff-manager-role.sql for the same rule. Nothing below casts a
-- literal to either new value (no seed row uses them), so there is
-- nothing here that could trip it.
-- ============================================================

alter type staff.credential_kind add value if not exists 'tb_screening'
  after 'collaborative_agreement';
alter type staff.credential_kind add value if not exists 'hepatitis_b_vaccination'
  after 'tb_screening';

-- staff.user_documents.doc_type is deliberately a plain text CHECK, not
-- this enum — see staff-documents.sql's own header for why (a CME log
-- and a peer review are documents, not credentials with an issuer and
-- an expiry). Widened to match the two kinds above.
--
-- The constraint's name is found rather than assumed: it was declared
-- inline in the original CREATE TABLE with no name of its own, so
-- Postgres chose one, and guessing wrong here would silently leave the
-- old, narrower constraint in place instead of replacing it.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'staff.user_documents'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%doc_type%'
  loop
    execute format('alter table staff.user_documents drop constraint %I', c.conname);
  end loop;
end $$;

alter table staff.user_documents add constraint user_documents_doc_type_check
  check (doc_type in (
    'bls_cpr', 'state_license', 'arrt_permit', 'board_certification',
    'malpractice', 'cme_log', 'peer_review',
    'tb_screening', 'hepatitis_b_vaccination', 'other'
  ));


-- ========== staff-protocols.sql ==========

-- ============================================================
-- THE PROTOCOL LIBRARY
--
-- Run AFTER supabase/staff-schema.sql. Idempotent.
--
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
-- ---------------------------------------------
-- This is SEARCH OVER THE CLINIC'S OWN DOCUMENTS. A provider types
-- "tetanus timing contaminated wound" and gets back the passages of this
-- clinic's wound-care protocol and whatever public guidance has been
-- loaded, verbatim, each with its source and section.
--
-- IT DOES NOT GENERATE CLINICAL ADVICE. No regimen is synthesised, no
-- contraindication is inferred, no dose is composed. The system returns
-- text somebody wrote and a citation for where it came from, and the
-- provider reads it — exactly like the binder on the shelf, only
-- searchable.
--
-- That boundary is the product decision. Software that analyses patient
-- specifics and recommends treatment is clinical decision support, with
-- an FDA exemption analysis and a malpractice conversation attached to
-- it; software that finds you the right page of your own protocol is a
-- search box. There is no schema here for a generated answer, because a
-- column to put one in is how the boundary erodes.
--
-- WHY FULL-TEXT AND NOT EMBEDDINGS. The brief asked for pgvector. This
-- corpus is one clinic's protocol set plus public guidance — hundreds of
-- sections, not millions — and the queries are dense with the exact
-- terms the documents use, because both are written by clinicians in the
-- same vocabulary. Postgres full-text ranks that well, costs nothing per
-- query, needs no embedding provider or API key, returns byte-identical
-- passages rather than nearest neighbours, and is deterministic, which
-- matters when the answer is a clinical document. Semantic search earns
-- its complexity when the query and the corpus use different words. If
-- that turns out to be the case here, the table takes an embedding
-- column later without anything else changing.
--
-- NO PATIENT INFORMATION. Queries are logged for "what is nobody able to
-- find", and a free-text box is exactly where somebody types a name. The
-- log column is capped and the app strips digit runs before writing.
-- ============================================================

create table if not exists staff.protocols (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  key text not null,

  title text not null,
  -- Where this came from, printed with every passage. A clinic protocol,
  -- a CDC page, a specialty society guideline. The first question about
  -- a clinical statement on a screen is who said it.
  source text not null,
  -- The clinic's own reference, where it has one: '#WOUND-04'.
  protocol_code text,
  -- Publication or last-review date of the SOURCE, not of the row. A
  -- guideline from 2019 presented without its year is a guideline
  -- presented as current.
  source_date date,

  -- Who this is for. Empty means everyone.
  job_roles staff.job_role[] not null default '{}',

  -- Reviewed by the medical director, and when. A protocol nobody has
  -- reviewed still appears in results, labelled as such — hiding it
  -- would mean the search quietly missed the document the clinic
  -- actually uses.
  reviewed_on date,
  reviewed_by uuid references staff.users(id),

  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references staff.users(id)
);

create unique index if not exists staff_protocols_key
  on staff.protocols (org_slug, key);

-- ============================================================
-- SECTIONS
--
-- Search returns a SECTION, not a document. Handing somebody a
-- forty-page protocol because one line in it matched is the failure mode
-- of every clinical search box, and at a bedside it is the same as
-- returning nothing.
-- ============================================================

create table if not exists staff.protocol_sections (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references staff.protocols(id) on delete cascade,
  section_no integer not null,

  heading text,
  body text not null,

  -- Generated, not maintained: a search index that a writer has to
  -- remember to refresh is a search index that is wrong.
  --
  -- Weighted A for the heading and B for the body, so a section titled
  -- "Tetanus prophylaxis" outranks one that mentions tetanus in passing.
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('english', body), 'B')
  ) stored,

  created_at timestamptz not null default now()
);

create unique index if not exists staff_protocol_sections_order
  on staff.protocol_sections (protocol_id, section_no);

create index if not exists staff_protocol_sections_search
  on staff.protocol_sections using gin (search);

-- ============================================================
-- QUERY LOG
--
-- Not analytics. This answers one operational question: what are people
-- searching for and not finding, which is the list of protocols this
-- clinic is missing.
-- ============================================================

create table if not exists staff.protocol_queries (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  asked_by uuid references staff.users(id) on delete set null,
  q text not null,
  hits integer not null default 0,
  asked_at timestamptz not null default now()
);

create index if not exists staff_protocol_queries_misses
  on staff.protocol_queries (org_slug, asked_at desc)
  where hits = 0;

-- How many words in the query matched nothing in the corpus. This is
-- the "we have no protocol for this" signal, kept as a NUMBER because
-- the words themselves are the ones that cannot be shown to be safe.
alter table staff.protocol_queries
  add column if not exists unknown_terms integer not null default 0;

-- A hard cap in the schema as well as the app. A free-text box is where
-- somebody eventually pastes a chart note, and 200 characters is a
-- question rather than a record.
do $$ begin
  alter table staff.protocol_queries
    add constraint staff_protocol_query_short
    check (length(q) <= 200);
exception when duplicate_object then null;
end $$;

-- ============================================================
-- WHAT MAY BE KEPT OF A QUERY
--
-- The app strips digit runs, dates and MRN-shaped tokens before this is
-- reached. THAT IS NOT ENOUGH AND IT CANNOT BE MADE ENOUGH: no regular
-- expression recognises "Maria Gonzalez" as a name rather than a place,
-- a drug, or a syndrome with two eponyms in it. Tested exactly that way
-- — the dates and the MRN were caught, the name went straight through.
--
-- So the log does not keep what was typed. It keeps only the lexemes
-- that ALREADY APPEAR SOMEWHERE IN THIS CLINIC'S PROTOCOL CORPUS. A word
-- has to be in a published protocol to survive, which a patient's name
-- structurally is not, and the number of words dropped is kept instead
-- so the "nobody can find anything about X" signal is not lost.
--
-- The cost is real and worth naming: a search for a condition the clinic
-- has never written a protocol about keeps none of its terms, which is
-- exactly the case somebody would most like to read. The count carries
-- it — a run of queries with four unknown terms and no hits is the
-- report — and that is the version of this feature that does not put
-- patient names in a table.
-- ============================================================

create or replace function staff.scrub_to_corpus(p_query text)
returns table (kept text, unknown_count integer)
language plpgsql stable as $$
declare
  terms text[];
  survivors text[];
  t text;
begin
  terms := tsvector_to_array(to_tsvector('english', coalesce(p_query, '')));
  if terms is null then
    return query select ''::text, 0;
    return;
  end if;

  survivors := '{}';
  foreach t in array terms loop
    if exists (
      select 1 from staff.protocol_sections s
       where s.search @@ to_tsquery('english', t)
       limit 1
    ) then
      survivors := survivors || t;
    end if;
  end loop;

  return query
    select array_to_string(survivors, ' ')::text,
           (cardinality(terms) - cardinality(survivors))::integer;
end $$;

grant execute on function staff.scrub_to_corpus(text) to staff_app;

-- ============================================================
-- ROW-LEVEL SECURITY
-- protocol_sections has no org column; it is reached only through its
-- protocol, so its policy joins back to one.
-- ============================================================

alter table staff.protocols enable row level security;
alter table staff.protocols force row level security;
drop policy if exists staff_org_isolation on staff.protocols;
create policy staff_org_isolation on staff.protocols
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

alter table staff.protocol_sections enable row level security;
alter table staff.protocol_sections force row level security;
drop policy if exists staff_org_isolation on staff.protocol_sections;
create policy staff_org_isolation on staff.protocol_sections
  for all
  using (exists (
    select 1 from staff.protocols p
     where p.id = protocol_sections.protocol_id
       and (staff.is_super_admin() or p.org_slug = staff.current_org())
  ))
  with check (exists (
    select 1 from staff.protocols p
     where p.id = protocol_sections.protocol_id
       and (staff.is_super_admin() or p.org_slug = staff.current_org())
  ));

alter table staff.protocol_queries enable row level security;
alter table staff.protocol_queries force row level security;
drop policy if exists staff_org_isolation on staff.protocol_queries;
create policy staff_org_isolation on staff.protocol_queries
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.protocols to staff_app;
grant select, insert, update on staff.protocol_sections to staff_app;
-- Insert-only: a query log that can be edited answers nothing.
grant select, insert on staff.protocol_queries to staff_app;
revoke delete on staff.protocols from staff_app;
revoke delete on staff.protocol_sections from staff_app;
revoke update, delete on staff.protocol_queries from staff_app;

-- ============================================================
-- SEARCH
--
-- One function rather than a view, because ranking needs the query.
-- STABLE and security_invoker semantics come from the underlying RLS on
-- the tables it reads — it is not SECURITY DEFINER, so it cannot see
-- past the caller's org.
-- ============================================================

-- ANY TERM, RANKED — NOT EVERY TERM.
--
-- The first version used websearch_to_tsquery directly, which joins bare
-- terms with AND. "tetanus timing contaminated wound" then required all
-- four lexemes in ONE section and returned nothing, while the section
-- headed "Tetanus toxoid timing by vaccination history" sat two rows
-- away in the same table. Clinicians type four or five words; sections
-- are a paragraph long; AND means an empty result almost every time.
--
-- Zero results is the worst possible failure here, because the person is
-- standing in a room with a patient and will conclude the protocol is
-- not in the system rather than that their phrasing was wrong.
--
-- So the terms are ORed and ts_rank does the work: a section matching
-- three of four lexemes outranks one matching one, and the A-weighted
-- heading outranks a passing mention in the body. Quoted phrases and
-- explicit operators are still honoured — if websearch_to_tsquery finds
-- any of those, that query is used as written, because somebody typing
-- quotes means them.
--
-- The OR query is built from tsvector_to_array(to_tsvector(...)), so
-- every element is an already-normalised lexeme. There is no path for a
-- tsquery operator to survive that and reach to_tsquery.
create or replace function staff.search_protocols(
  p_query text,
  p_job staff.job_role default null,
  p_limit integer default 12
)
returns table (
  protocol_id uuid,
  section_id uuid,
  title text,
  source text,
  protocol_code text,
  source_date date,
  reviewed_on date,
  heading text,
  body text,
  section_no integer,
  rank real
)
language plpgsql stable as $$
declare
  q tsquery;
  lexemes text[];
begin
  -- Quotes or explicit operators: honour them exactly.
  if p_query ~ '["|()<>-]' then
    q := websearch_to_tsquery('english', p_query);
  else
    lexemes := tsvector_to_array(to_tsvector('english', p_query));
    if lexemes is null or cardinality(lexemes) = 0 then
      return;
    end if;
    q := to_tsquery('english', array_to_string(lexemes, ' | '));
  end if;

  if q is null then return; end if;

  return query
  select
    p.id, s.id, p.title, p.source, p.protocol_code, p.source_date,
    p.reviewed_on, s.heading, s.body, s.section_no,
    ts_rank(s.search, q) as rank
  from staff.protocol_sections s
  join staff.protocols p on p.id = s.protocol_id
  where p.active
    and staff.brief_matches(p.job_roles, p_job)
    and s.search @@ q
  order by rank desc, p.title, s.section_no
  limit greatest(1, least(coalesce(p_limit, 12), 50));
end $$;

grant execute on function staff.search_protocols(text, staff.job_role, integer)
  to staff_app;


-- ========== staff-protocols-seed.sql ==========

-- ============================================================
-- PROTOCOL LIBRARY — seed
--
-- Run AFTER supabase/staff-protocols.sql. Idempotent.
--
-- PROVENANCE, and read this before trusting a word of it.
--
-- These are STARTER SECTIONS drawn from long-standing, widely published
-- public guidance — CDC tetanus prophylaxis, the Ottawa ankle and knee
-- rules, CDC/IDSA pharyngitis and the Centor score, OSHA's bloodborne
-- pathogens standard. They are here so the search box is not empty on
-- day one and so a clinic can see the shape of a section.
--
-- THEY ARE NOT THIS CLINIC'S PROTOCOLS AND EVERY ROW SAYS SO. Each is
-- seeded with reviewed_on NULL, which the app renders as "not reviewed
-- by your medical director" on every result. A clinic replaces or
-- reviews them; nothing here is presented as locally approved until
-- somebody local approves it.
--
-- NOTHING PAYWALLED IS REPRODUCED HERE. No journal text, no society
-- document behind a licence. Indexing a subscription journal into a
-- searchable corpus is a copyright question for the clinic and its
-- publisher, not something a seed file should decide by doing it.
--
-- AND NOTHING HERE IS A RECOMMENDATION. The rows are passages with
-- citations. The system shows them; the clinician reads them and
-- decides. See the header of staff-protocols.sql.
-- ============================================================

create or replace function staff.seed_protocols(p_slug text)
returns integer language plpgsql as $$
declare
  n integer := 0;
  r record;
  pid uuid;
begin
  insert into staff.protocols
    (org_slug, key, title, source, protocol_code, source_date, job_roles)
  select p_slug, d.key, d.title, d.source, d.code, d.src_date, d.job_roles
  from (values
    ('tetanus-prophylaxis',
     'Tetanus prophylaxis in wound management',
     'CDC — Epidemiology and Prevention of Vaccine-Preventable Diseases',
     null, date '2021-08-01',
     array['provider','medical_assistant']::staff.job_role[]),

    ('ottawa-rules',
     'Ottawa ankle and knee rules',
     'Ottawa Ankle Rules, Stiell et al. — public decision rule',
     null, date '1993-01-01',
     array['provider','xray_tech']::staff.job_role[]),

    ('pharyngitis-centor',
     'Sore throat: Centor score and testing',
     'CDC — Pharyngitis (Strep Throat) adult treatment guidance',
     null, date '2021-06-01',
     array['provider','medical_assistant']::staff.job_role[]),

    ('bbp-exposure',
     'Needlestick and bloodborne pathogen exposure',
     'OSHA 29 CFR 1910.1030',
     null, date '2011-04-01',
     '{}'::staff.job_role[])
  ) as d(key, title, source, code, src_date, job_roles)
  where not exists (
    select 1 from staff.protocols x where x.org_slug = p_slug and x.key = d.key
  );
  get diagnostics n = row_count;

  for r in select id, key from staff.protocols where org_slug = p_slug loop
    pid := r.id;
    if exists (select 1 from staff.protocol_sections s where s.protocol_id = pid) then
      continue;
    end if;

    if r.key = 'tetanus-prophylaxis' then
      insert into staff.protocol_sections (protocol_id, section_no, heading, body) values
        (pid, 1, 'Deciding whether the wound is clean and minor',
         'Wound management decisions turn on two things: whether the wound is clean and minor, and how many doses of tetanus toxoid the patient has had. Wounds contaminated with dirt, faeces, soil or saliva, puncture wounds, avulsions, and wounds from crushing, burns or frostbite are all treated as NOT clean and minor.'),
        (pid, 2, 'Tetanus toxoid timing by vaccination history',
         'For a clean, minor wound: give tetanus toxoid if the patient has had fewer than three doses, or if it has been ten years or more since the last dose. For all other wounds: give tetanus toxoid if fewer than three doses, or if it has been five years or more since the last dose.'),
        (pid, 3, 'Tetanus immune globulin',
         'Tetanus immune globulin is indicated for wounds that are not clean and minor when the patient has had fewer than three doses of tetanus toxoid, or when the vaccination history is unknown. It is not indicated for clean minor wounds regardless of history.'),
        (pid, 4, 'Which vaccine',
         'Tdap is preferred over Td for adolescents and adults who have not previously received Tdap. Where both a vaccine and immune globulin are given, they are administered at separate sites with separate syringes.');

    elsif r.key = 'ottawa-rules' then
      insert into staff.protocol_sections (protocol_id, section_no, heading, body) values
        (pid, 1, 'Ottawa ankle rule — when an ankle x-ray is indicated',
         'An ankle x-ray series is indicated only if there is pain in the malleolar zone AND any one of: bone tenderness along the distal 6 cm of the posterior edge of the lateral malleolus, bone tenderness along the distal 6 cm of the posterior edge of the medial malleolus, or an inability to bear weight both immediately and in the department for four steps.'),
        (pid, 2, 'Ottawa foot rule — when a foot x-ray is indicated',
         'A foot x-ray series is indicated only if there is pain in the midfoot zone AND any one of: bone tenderness at the base of the fifth metatarsal, bone tenderness at the navicular, or an inability to bear weight both immediately and in the department for four steps.'),
        (pid, 3, 'Ottawa knee rule',
         'A knee x-ray is indicated for acute knee injury with any one of: age 55 or over, isolated tenderness of the patella, tenderness at the head of the fibula, inability to flex to 90 degrees, or inability to bear weight for four steps both immediately and in the department.'),
        (pid, 4, 'Limits of the rules',
         'These rules were derived and validated in adults with acute injury. They are not validated for intoxicated or uncooperative patients, patients with distracting painful injuries, patients with diminished sensation in the leg, or those presenting more than ten days after injury.');

    elsif r.key = 'pharyngitis-centor' then
      insert into staff.protocol_sections (protocol_id, section_no, heading, body) values
        (pid, 1, 'Centor criteria',
         'One point each for: tonsillar exudate, tender anterior cervical lymphadenopathy, fever by history, and absence of cough. The modified score adds a point for age 3 to 14 and subtracts one for age 45 and over.'),
        (pid, 2, 'Testing and treatment by score',
         'A score of 0 or 1 does not warrant testing or antibiotics. A score of 2 or 3 warrants a rapid antigen detection test, with treatment only if positive. A score of 4 or more still warrants testing rather than empiric antibiotics in most outpatient settings.'),
        (pid, 3, 'Negative rapid test in children',
         'A negative rapid antigen test in a child or adolescent is backed up by throat culture, because rapid tests are less sensitive in this group and untreated group A strep carries a rheumatic fever risk.'),
        (pid, 4, 'Symptoms that are not strep',
         'Cough, rhinorrhoea, hoarseness, oral ulcers and conjunctivitis point to a viral cause. Testing patients with these features raises the number of carriers found and treated without benefit.');

    elsif r.key = 'bbp-exposure' then
      insert into staff.protocol_sections (protocol_id, section_no, heading, body) values
        (pid, 1, 'Immediately after a needlestick or splash',
         'Wash the site with soap and water. Flush mucous membranes with water. Do not squeeze the wound and do not apply caustic agents or disinfectants into it. Report it before the end of the shift, however minor it seems.'),
        (pid, 2, 'This is time-critical',
         'HIV post-exposure prophylaxis, where indicated, is most effective the sooner it is started and is generally considered up to 72 hours after exposure. An exposure reported the next morning may be an exposure that can no longer be treated.'),
        (pid, 3, 'What the employer owes you',
         'Under the OSHA bloodborne pathogens standard the employer provides a confidential medical evaluation and follow-up at no cost to the employee, including post-exposure prophylaxis where indicated, and records the incident on the sharps injury log.'),
        (pid, 4, 'The sharps injury log',
         'The log records the type and brand of device involved, the department or work area where the incident occurred, and an explanation of how it happened. It is maintained so that individual identity is protected.');
    end if;
  end loop;

  return n;
end $$;

grant execute on function staff.seed_protocols(text) to staff_app;

create or replace function staff.protocols_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_protocols(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_protocols on staff.orgs;
create trigger staff_orgs_seed_protocols
  after insert on staff.orgs
  for each row execute function staff.protocols_seed_new_org();

do $$
declare o record;
begin
  for o in select slug from staff.orgs loop
    perform staff.seed_protocols(o.slug);
  end loop;
end $$;


-- ========== staff-emergency.sql ==========

-- ============================================================
-- EMERGENCY ACTION GUIDES
--
-- Run AFTER supabase/staff-rounds.sql. Idempotent.
--
-- WHY THIS IS staff.rounds AND NOT A NEW TABLE
-- --------------------------------------------
-- The brief asked for a Learning tab holding role-filtered emergency
-- checklists: anaphylaxis for the MA, radiation emergency stop for the
-- x-ray tech, STEMI escalation for the provider, active threat for the
-- front desk.
--
-- Structurally that is what staff.rounds already is — an ordered list of
-- imperative steps, scoped to a job, read one at a time. Building a
-- second table with the same shape would mean two step editors, two
-- role filters, two places for a clinic to look, and eventually two
-- answers about what the anaphylaxis procedure says. So this adds one
-- column to distinguish them and reuses everything else.
--
-- WHAT ACTUALLY DIFFERS, AND IT IS ONE THING THAT MATTERS
-- ------------------------------------------------------
-- A round is WALKED and SIGNED: the record is that somebody did it.
--
-- An emergency guide is READ WHILE SOMETHING IS HAPPENING. Nobody signs
-- an attestation during an anaphylaxis. Requiring one would mean the
-- app asks a person to confirm paperwork while a patient is losing an
-- airway, and the honest outcome is that they close the app and never
-- open it in an emergency again — losing the one moment the guide
-- exists for.
--
-- So kind='emergency' guides:
--   * take no attestation and write no run record
--   * show EVERY step at once rather than one behind a Next button
--   * sort by how fast you need them, not alphabetically
--
-- ALL STEPS VISIBLE IS THE OPPOSITE OF THE ROUND RUNNER and it is the
-- correct opposite. The runner hides the next step so the walk cannot be
-- faked from the counter. Here there is nothing to fake and everything
-- to lose: somebody needs to see that step 6 is "call 911" before they
-- have finished step 1, and a paginated emergency procedure is a
-- procedure that gets abandoned.
-- ============================================================

alter table staff.rounds
  add column if not exists kind text not null default 'round';

do $$ begin
  alter table staff.rounds
    add constraint staff_rounds_kind_known
    check (kind in ('round', 'emergency'));
exception when duplicate_object then null;
end $$;

comment on column staff.rounds.kind is
  'round = walked and signed, one step at a time. emergency = read during an incident, all steps visible, no attestation.';

-- Nothing may file a run against an emergency guide. The app does not
-- offer it, and this makes that true regardless of what the app does —
-- an attestation that somebody "completed" an anaphylaxis is a record
-- of paperwork, not of care, and would sit in the same table as records
-- that mean something.
create or replace function staff.round_runs_reject_emergency()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from staff.rounds r
     where r.id = new.round_id and r.kind = 'emergency'
  ) then
    raise exception 'emergency guides are read, not signed for'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists staff_round_runs_no_emergency on staff.round_runs;
create trigger staff_round_runs_no_emergency
  before insert on staff.round_runs
  for each row execute function staff.round_runs_reject_emergency();

-- The board splits on kind, so /staff/rounds keeps showing rounds and
-- /staff/learning shows guides, from one view.
--
-- Dropped first rather than CREATE OR REPLACE: replace can only APPEND
-- columns, and kind belongs beside the other descriptive columns.
drop view if exists staff.round_board cascade;
create view staff.round_board
with (security_invoker = true) as
select
  r.id,
  r.org_slug,
  r.key,
  r.kind,
  r.job_roles,
  r.title,
  r.purpose,
  r.cadence,
  r.sort_order,
  (select count(*) from staff.round_steps s where s.round_id = r.id)::int
    as step_count,
  last_run.completed_at as last_walked_at,
  last_run.walker       as last_walked_by,
  jsonb_array_length(coalesce(last_run.exceptions, '[]'::jsonb))::int
    as last_exception_count
from staff.rounds r
left join lateral (
  select ru.completed_at, ru.exceptions, u.legal_name as walker
    from staff.round_runs ru
    left join staff.users u on u.id = ru.walked_by
   where ru.round_id = r.id
   order by ru.completed_at desc
   limit 1
) last_run on true
where r.active;

grant select on staff.round_board to staff_app;



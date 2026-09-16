-- ============================================================
-- THE BILLING SPECIALIST'S END-OF-DAY REPORT — structured, so it can be
-- checked, not just trusted
--
-- The report this replaces was one long email: a clock-in/clock-out
-- line, then a wall of "PID 336378 / Payment Processed / Amount:
-- $169.95," free narrative underneath some of them, and a name
-- appearing in prose wherever it was easiest to write one. That is
-- exactly the shape a HIPAA violation takes — not maliciously, just
-- because prose is where identifiers hide.
--
-- THE ACCOUNT REFERENCE STAYS. Removing it would make the report
-- useless — nobody could tell which account $48 belongs to. It stays
-- inside the app, in a structured field, visible only to the person who
-- filed it and an org_admin reviewing it — the same audience who could
-- already see it by opening the account directly. It never rides along
-- into an email or a text; nothing in this app's alert/digest/huddle
-- machinery reads this table.
--
-- THE ACTION IS A FIXED LIST, NOT PROSE, for the same reason a form
-- beats a paragraph everywhere else in this schema: "write off the
-- balance" and "payment can't be posted" are facts about the account,
-- not facts about the patient, and a dropdown cannot accidentally grow
-- a name the way a sentence can.
--
-- NOTES AND GENERAL NOTES ARE FREE TEXT, ON PURPOSE — some of what she
-- actually reports ("the patient's mother said she paid during the
-- visit") doesn't reduce to a dropdown. That is exactly the text
-- app/api/staff/billing-report/route.ts scans before saving — see
-- lib/staff/eod-billing-report.ts's scanForIdentifiers() for what it
-- catches and, just as important, what it cannot.
-- ============================================================

create table if not exists staff.eod_billing_reports (
  id            uuid primary key default gen_random_uuid(),
  org_slug      text not null references staff.orgs(slug) on delete cascade,
  submitted_by  uuid not null references staff.users(id),
  work_date     date not null,
  -- Plain text, as she'd write it ("7:50 PM (PHT)") — nothing here is
  -- payroll or attendance, just what she'd have put at the top of the
  -- email anyway. See the header: there is no clock to punch.
  clock_in      text,
  clock_out     text,
  general_notes text,
  -- Set when scanForIdentifiers() flags something in general_notes.
  -- See the flag's twin on eod_billing_entries below for why this is a
  -- review marker and not a block: routing the flagged text back
  -- through a redirect URL to ask "are you sure?" would itself be the
  -- leak this whole table exists to prevent.
  general_notes_needs_review boolean not null default false,
  finalized_at  timestamptz,
  created_at    timestamptz not null default now(),
  -- One report per person per day. Filing twice for the same date
  -- updates the one row (see startOrGetReport() in
  -- lib/staff/eod-billing-report.ts) rather than creating a second.
  unique (submitted_by, work_date)
);

create index if not exists staff_eod_billing_reports_org_date
  on staff.eod_billing_reports (org_slug, work_date desc);

alter table staff.eod_billing_reports enable row level security;
alter table staff.eod_billing_reports force row level security;
drop policy if exists staff_org_isolation on staff.eod_billing_reports;
create policy staff_org_isolation on staff.eod_billing_reports
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.eod_billing_reports to staff_app;

create table if not exists staff.eod_billing_entries (
  id                uuid primary key default gen_random_uuid(),
  org_slug          text not null references staff.orgs(slug) on delete cascade,
  report_id         uuid not null references staff.eod_billing_reports(id) on delete cascade,
  reference_number  text not null,
  action            text not null check (action in (
    'payment_processed',
    'write_off',
    'charge_entry_check',
    'claim_resubmit',
    'balance_check',
    'payment_issue',
    'insurance_correction',
    'other'
  )),
  amount            numeric(10,2),
  note              text,
  -- Set when scanForIdentifiers() (lib/staff/eod-billing-report.ts)
  -- flags something in note. ALWAYS SAVED EITHER WAY — a hard block
  -- would have to round-trip the flagged text through a redirect to
  -- ask "are you sure," and putting it in a URL is a worse leak than
  -- the one being guarded against. Instead this surfaces as a warning
  -- on her own page and the admin review page, both already
  -- access-controlled the same way the rest of the row is.
  needs_review      boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists staff_eod_billing_entries_report
  on staff.eod_billing_entries (report_id);

alter table staff.eod_billing_entries enable row level security;
alter table staff.eod_billing_entries force row level security;
drop policy if exists staff_org_isolation on staff.eod_billing_entries;
create policy staff_org_isolation on staff.eod_billing_entries
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert on staff.eod_billing_entries to staff_app;

comment on table staff.eod_billing_reports is
  'One row per billing specialist per day — see the header of staff-eod-billing-report.sql. Who may write is app/api/staff/billing-report/route.ts''s concern, not RLS''s: only the billing_specialist job can file for themselves, only org_admin+ can read anyone else''s.';
comment on table staff.eod_billing_entries is
  'Line items on one day''s billing report. reference_number is the account/PID reference — kept, never redacted; note is free text and gets scanned before saving.';

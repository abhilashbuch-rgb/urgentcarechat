-- ============================================================
-- TONIGHT'S PATIENT COUNT, HANDED TO BILLING — NOT A COMPLIANCE LOG
--
-- Run AFTER supabase/staff-org-settings.sql and staff-reports.sql. Idempotent.
--
-- WHAT THIS IS NOT. The EMR already carries the authoritative patient
-- count for the day — duplicating it here as a second source of truth
-- would just leave the clinic with two numbers that can disagree. This
-- exists for one narrow reason: whoever closes out the front desk each
-- night can, in the same motion, put a same-night count and a note in
-- front of the billing team without a second login or a phone call.
--
-- WHY NOT A FORM TEMPLATE. Every compliance log in staff.form_templates
-- is audited, immutable, and counted toward "still due today" on the
-- board. This isn't one of those — nothing is being surveyed, nothing
-- goes overdue, there is no min/max range to flag. Bolting it onto that
-- machinery would mean explaining to an inspector why a patient count
-- appears in a compliance binder. So this is its own small table with
-- its own one-purpose route, not another row in form_templates.
--
-- WHO FILES IT AND WHO RECEIVES IT ARE TWO DIFFERENT AXES, ON PURPOSE.
-- Any front-desk-facing account can type in tonight's count — see
-- app/api/staff/billing-stats/route.ts. billing_contact_email below is
-- the one thing on this whole flow reserved for the owner, mirroring
-- staff-org-settings.sql exactly: the recipient of a financial email is
-- a decision that belongs to whoever answers for the money, never
-- something a nightly form submission can redirect. A biller's address
-- that anyone on shift could repoint is the same shape as the
-- invoice-fraud pattern this is built to not be.
-- ============================================================

-- ---------- 1. Where the count goes — owner-only, one column ----------

alter table staff.orgs
  add column if not exists billing_contact_email text;

do $$ begin
  alter table staff.orgs add constraint staff_orgs_billing_contact_email
    check (billing_contact_email is null
           or billing_contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$');
exception when duplicate_object then null; end $$;

-- Reaches this one column on staff.orgs and nothing else — see
-- staff-org-settings.sql for why a wider RLS policy or a direct UPDATE
-- from the app would also expose the billing-STATE columns on the same
-- row (is_read_only, the Stripe ids) to anyone who could reach this one.
create or replace function staff.update_billing_contact(
  p_org text,
  p_email text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update staff.orgs
     set billing_contact_email = nullif(btrim(coalesce(p_email, '')), '')
   where slug = p_org;

  if not found then
    raise exception 'no such organization: %', p_org
      using errcode = 'no_data_found';
  end if;
end $$;

revoke all on function staff.update_billing_contact(text, text) from public;
grant execute on function staff.update_billing_contact(text, text) to staff_app;


-- ---------- 2. The count itself — anyone on shift can file it ----------

create table if not exists staff.billing_stats (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  stats_date date not null,
  patient_count integer not null check (patient_count >= 0),
  notes text,
  submitted_by uuid references staff.users(id) on delete set null,
  submitted_at timestamptz not null default now(),

  -- One count per night. Filing it again the same day corrects the
  -- number and resends rather than piling up a second row for the
  -- same date — see the route for why a resubmit re-emails on purpose.
  unique (org_slug, stats_date)
);

create index if not exists staff_billing_stats_org_date
  on staff.billing_stats (org_slug, stats_date desc);

alter table staff.billing_stats enable row level security;
alter table staff.billing_stats force row level security;
drop policy if exists staff_org_isolation on staff.billing_stats;
create policy staff_org_isolation on staff.billing_stats
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update, delete on staff.billing_stats to staff_app;

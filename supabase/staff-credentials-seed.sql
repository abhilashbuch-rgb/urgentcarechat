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

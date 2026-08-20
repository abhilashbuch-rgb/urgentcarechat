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

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

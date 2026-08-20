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

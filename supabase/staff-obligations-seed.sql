-- ============================================================
-- THE STARTING REGISTER
--
-- Run AFTER supabase/staff-obligations.sql. Idempotent.
--
-- An empty register is worse than no register: it reads as "nothing is
-- owed" when what it means is "nobody has typed anything in yet". So a
-- new clinic starts with the recurring obligations that apply to
-- essentially every US urgent care, dated, and unowned — because unowned
-- is the honest starting state and the register shows it in red.
--
-- ACCURACY NOTE, and please read it before trusting the dates.
--
-- Where a regulation states a frequency, the citation is exact and the
-- interval is the regulation's own: the OSHA bloodborne pathogens plan
-- really does say "at least annually", and the fire extinguisher check
-- really is an annual maintenance check.
--
-- Where a regulation requires something but states NO frequency — most of
-- the HIPAA items — the interval here is convention, not law, and the
-- detail text says so. Annual is what auditors expect and what the
-- Security Rule's "review periodically" is universally read to mean, but
-- an obligation that claims a rule says something it doesn't is worse
-- than no obligation at all, because the first person to check loses
-- confidence in every other row.
--
-- Items with no citation are practice standards, marked as such.
--
-- The list is a starting point for an administrator to correct, not a
-- compliance opinion. Intervals, applicability, and state-level additions
-- differ by state, by NAICS code, by payer, and by accreditation body.
-- ============================================================

create or replace function staff.seed_obligations(p_slug text)
returns integer
language plpgsql as $$
declare n integer;
begin
  with library (key, title, detail, category, citation, source,
                repeat_months, fixed_month, fixed_day, offset_days) as (
    values
      ('hipaa-sra',
       'HIPAA Security Risk Analysis',
       'An accurate and thorough assessment of the risks to electronic PHI, documented. The rule requires the analysis and requires it to be reviewed and updated as conditions change; it does not name an interval. Annual is the convention and what an OCR investigator will expect to see dated.',
       'HIPAA', '45 CFR 164.308(a)(1)(ii)(A)', 'HIPAA Security Rule', 12, null, null, 30),

      ('hipaa-policy-review',
       'HIPAA policies and procedures review',
       'Review the documented security policies and procedures and update them where the practice has changed. The rule says "periodically"; annual is the convention.',
       'HIPAA', '45 CFR 164.316(b)(2)(iii)', 'HIPAA Security Rule', 12, null, null, 45),

      ('hipaa-training',
       'Workforce HIPAA privacy and security training',
       'Training for every member of the workforce, including new hires within a reasonable period. Neither rule names an interval for refresher training; annual is the convention. Individual acknowledgements are signed in this app under My record — this row is the organization-level evidence that the session happened.',
       'HIPAA', '45 CFR 164.530(b)(1); 45 CFR 164.308(a)(5)', 'HIPAA Privacy and Security Rules', 12, null, null, 60),

      ('hipaa-baa-review',
       'Business Associate Agreement review',
       'Confirm a current signed BAA exists for every vendor that touches PHI — EHR, billing, transcription, shredding, IT support, cloud backup. No stated interval; annual review is the convention, and the moment a vendor changes is the other time to do it.',
       'HIPAA', '45 CFR 164.308(b)(1); 45 CFR 164.502(e)', 'HIPAA Privacy and Security Rules', 12, null, null, 75),

      ('osha-ecp-review',
       'Bloodborne pathogens Exposure Control Plan review',
       'The plan must be reviewed and updated at least annually, and the review must document consideration of safer engineered sharps devices. This one is annual in the regulation itself, not by convention.',
       'OSHA', '29 CFR 1910.1030(c)(1)(iv)', 'OSHA Bloodborne Pathogens Standard', 12, null, null, 21),

      ('osha-bbp-training',
       'Bloodborne pathogens training',
       'Annual training for every employee with occupational exposure, within one year of their previous training. Annual in the regulation.',
       'OSHA', '29 CFR 1910.1030(g)(2)(ii)', 'OSHA Bloodborne Pathogens Standard', 12, null, null, 35),

      ('osha-hazcom',
       'Hazard communication program and SDS review',
       'Chemical inventory current, safety data sheets on hand and accessible during every shift, labels intact. No stated review interval; annual is the convention.',
       'OSHA', '29 CFR 1910.1200', 'OSHA Hazard Communication Standard', 12, null, null, 90),

      ('osha-300a',
       'Post OSHA Form 300A summary',
       'Post the annual injury and illness summary by February 1 and keep it up until April 30. APPLICABILITY VARIES: employers with ten or fewer employees and certain partially exempt industry codes are excused from routine recordkeeping, and whether an urgent care center is exempt depends on the NAICS code it operates under. Confirm which applies to this site before treating this as due.',
       'OSHA', '29 CFR 1904.32', 'OSHA recordkeeping', 12, 2, 1, null),

      ('fire-extinguisher',
       'Fire extinguisher annual maintenance check',
       'An annual maintenance check on every portable extinguisher, with the date recorded on the tag and the record kept for a year after the tag is replaced. Annual in the regulation.',
       'Life safety', '29 CFR 1910.157(e)(3)', 'OSHA portable fire extinguishers', 12, null, null, 40),

      ('eyewash-annual',
       'Eyewash station annual performance evaluation',
       'A full performance evaluation of every plumbed eyewash — flow, pattern, temperature, duration. The weekly activation is a separate log in this app. OSHA requires suitable facilities without naming a test interval; the annual evaluation comes from ANSI Z358.1, the consensus standard OSHA cites.',
       'Life safety', '29 CFR 1910.151(c); ANSI Z358.1', 'OSHA medical services and first aid', 12, null, null, 50),

      ('clia-renewal',
       'CLIA certificate renewal',
       'Certificates run two years. The renewal notice arrives roughly six months out and is easy to lose. Waived testing performed on an expired certificate is unbillable and, depending on the state, unlawful.',
       'Laboratory', '42 CFR 493', 'CLIA', 24, null, null, 120),

      ('crash-cart-expiry',
       'Emergency medication and supply expiry review',
       'Every dated item on the crash cart and in the emergency kit — epinephrine, naloxone, atropine, IV fluids, defibrillator pads and battery. Monthly, because the failure mode is discovering the expiry during the emergency.',
       'Clinical', null, 'Practice standard', 1, null, null, 14),

      ('license-review',
       'Provider licence and credential expiry review',
       'Walk the roster: state licences, DEA registrations where applicable, BLS and ACLS cards, malpractice coverage, payer credentialing. Quarterly, so a lapse surfaces with time to renew rather than on the day someone is scheduled.',
       'Employment', null, 'Practice standard', 3, null, null, 28),

      ('vaccine-storage-review',
       'Vaccine storage and handling plan review',
       'Review the storage and handling plan and the emergency plan for a unit failure: where stock goes, who is called, how transport temperature is documented. The daily fridge temperatures are a separate log in this app; this is the plan behind them.',
       'Clinical', null, 'CDC Vaccine Storage and Handling Toolkit', 12, null, null, 65),

      ('flu-readiness',
       'Influenza season readiness',
       'Before the season starts: doses ordered, storage capacity confirmed, standing orders signed and current, staff vaccination offered and documented, billing set up for the new season codes.',
       'Clinical', null, 'Practice standard', 12, 9, 1, null),

      ('emergency-drill',
       'Emergency preparedness drill',
       'Run and document one drill — evacuation, power failure, or a medical emergency in the waiting room — with who took part and what it exposed. Not a federal requirement for a freestanding urgent care that is not a CMS-certified provider type; it is what an accreditation surveyor asks for and what a state inspector expects.',
       'Life safety', null, 'Practice standard', 12, null, null, 100)
  )
  insert into staff.obligations
    (org_slug, key, title, detail, category, citation, source, due_on, repeat_months)
  select
    p_slug, l.key, l.title, l.detail, l.category, l.citation, l.source,
    case
      -- Calendar-fixed deadlines land on their date: the next one that
      -- hasn't already passed.
      when l.fixed_month is not null then
        case
          when make_date(
                 extract(year from current_date)::int, l.fixed_month, l.fixed_day
               ) >= current_date
          then make_date(extract(year from current_date)::int, l.fixed_month, l.fixed_day)
          else make_date(extract(year from current_date)::int + 1, l.fixed_month, l.fixed_day)
        end
      -- Everything else is staggered rather than all dated today. Sixteen
      -- obligations due on the day you sign up is a register nobody
      -- opens twice.
      else current_date + l.offset_days
    end,
    l.repeat_months
  from library l
  -- Idempotent by key rather than by (key, due_on): re-running months
  -- later would compute different stagger dates and quietly file a second
  -- copy of everything.
  where not exists (
    select 1 from staff.obligations o
     where o.org_slug = p_slug and o.key = l.key
  );

  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function staff.seed_obligations(text) to staff_app;

-- Every path that creates an org gets a register: provision_org from a
-- Stripe checkout, provision_trial from /start, and an insert typed by
-- hand. Hanging this off the table rather than editing each function
-- means a future fourth path cannot forget.
create or replace function staff.obligations_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_obligations(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_obligations on staff.orgs;
create trigger staff_orgs_seed_obligations
  after insert on staff.orgs
  for each row execute function staff.obligations_seed_new_org();

-- Backfill any org that already exists.
do $$
declare o record;
begin
  for o in select slug from staff.orgs loop
    perform staff.seed_obligations(o.slug);
  end loop;
end $$;

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

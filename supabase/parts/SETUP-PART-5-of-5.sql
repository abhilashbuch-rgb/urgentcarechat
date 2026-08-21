-- ============================================================
-- medicin. STAFF MODULE — SETUP PART 5 OF 5
--
-- RUN THE PARTS IN ORDER, 1 through 5, each as its own paste.
-- Wait for one to report success before starting the next; a later part
-- refers to tables an earlier one creates.
--
-- Every part is idempotent on its own, so re-running one is safe and a
-- part that half-succeeded can simply be run again.
--
-- Migrations in this part:
--   staff-privacy-rules
-- ============================================================

-- ========== staff-privacy-rules.sql ==========

-- ============================================================
-- PRIVACY AND PATIENT INTERACTION, AS STANDING RULES
--
-- HIPAA already lives in the policy packet, which is signed once on a
-- first morning and never opened again. That is the wrong shape for the
-- knowledge somebody needs while a patient's brother is standing at the
-- counter asking whether she is here.
--
-- staff.scope_items is the right shape and already exists: a prohibited
-- item cannot be inserted without the sanctioned alternative beside it,
-- enforced by a CHECK rather than by good intentions. So privacy joins
-- scope of practice on /staff/rules, in the same two columns.
--
-- WRITTEN AS WHAT TO SAY, NOT AS WHAT NOT TO DO. A list that scolds gets
-- skimmed once. A list that solves the awkward moment at the desk gets
-- remembered, and the difference is entirely in whether the right-hand
-- column contains a sentence somebody can actually use out loud.
--
-- SCOPED BY JOB, because the situations are not shared. The front desk
-- meets the relative at the counter several times a week; a provider
-- meets the records request; an x-ray tech meets the corridor
-- conversation. Giving every rule to everybody is how a list becomes
-- long enough to ignore.
--
-- CITATIONS ARE EXACT OR ABSENT. Where 45 CFR 164 says a thing, it is
-- cited. Where this is the clinic's own judgement about what is
-- sensible, the citation is null and the page prints it as clinic
-- policy, which is honest and is also what a surveyor would rather see
-- than a fabricated authority.
-- ============================================================

-- A FUNCTION AND A TRIGGER, NOT A ONE-OFF INSERT. Written as a plain
-- backfill, these rules would reach every clinic that existed the day the
-- migration ran and no clinic that signed up after it — so the second
-- customer would open /staff/rules and find the scope of practice there
-- and the privacy half missing. Every other seed in this schema is a
-- function plus an after-insert trigger for exactly that reason; this one
-- matches them.
create or replace function staff.seed_privacy(p_slug text)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into staff.scope_items
    (org_slug, key, job_role, kind, item, instead, citation, sort_order)
  select p_slug, v.key, v.job_role::staff.job_role, v.kind, v.item, v.instead,
         v.citation, v.sort_order
    from (values

-- ---------- Front desk ----------
-- The counter is where almost all of this happens, and where the person
-- asking is usually not being difficult. They are worried.
('priv-fd-presence', 'front_desk', 'prohibited',
 'Confirm or deny that a particular person is here, to anyone who asks',
 'Say: "I''m not able to confirm whether anyone is here. If they''ve told us it''s alright to talk to you, I can check that - what''s your name?" Then look for a release on file.',
 '45 CFR 164.510(b) - disclosure to family and others requires the patient''s agreement or an opportunity to object',
 200),

('priv-fd-phone', 'front_desk', 'prohibited',
 'Discuss a patient with a caller on the telephone',
 'Say: "I can''t go through patient details over the phone. If you''re with them, they''re welcome to call you from here." A voice on a telephone cannot be identified.',
 null,
 201),

('priv-fd-signin', 'front_desk', 'prohibited',
 'Leave a paper sign-in sheet, a chart or a screen where the next person in the queue can read it',
 'Turn the screen, invert the sheet, or hand the clipboard over face down. A sign-in list is permitted; a list of everyone''s reason for coming is not.',
 '45 CFR 164.530(c) - reasonable safeguards against incidental disclosure',
 202),

('priv-fd-records', 'front_desk', 'prohibited',
 'Hand over records, imaging or results because somebody has asked at the counter',
 'Say: "Records go through a written request - let me give you the form and tell you how long it usually takes." Then pass it to whoever handles releases.',
 '45 CFR 164.524 - right of access, on request, within 30 days',
 203),

('priv-fd-name', 'front_desk', 'authorized',
 'Call a patient by first name and last initial in the waiting room',
 null, null, 204),

-- ---------- Medical assistant ----------
('priv-ma-corridor', 'medical_assistant', 'prohibited',
 'Discuss a patient in a corridor, at the desk, or anywhere the waiting room can hear',
 'Move it into a room and close the door, or hold it until you can. If somebody starts the conversation in the open, say: "Let''s step in here."',
 '45 CFR 164.530(c) - reasonable safeguards',
 210),

('priv-ma-colleague', 'medical_assistant', 'prohibited',
 'Look at, or talk about, the record of a patient you are not caring for',
 'Say: "I''m not on that one - you''d want to ask whoever is." Curiosity about a neighbour or a colleague is the most common way access gets audited and lost.',
 '45 CFR 164.502(b) - minimum necessary',
 211),

-- The one this product itself creates. CameraProof asks staff to
-- photograph a fridge display or a crash cart seal, so the rule belongs
-- here rather than only in the component.
('priv-ma-photo', 'medical_assistant', 'prohibited',
 'Photograph equipment without checking what else is in the frame',
 'Before you tap the shutter, look at the edges: a monitor with a name on it, a whiteboard, a chart on the counter. Move the chart or change the angle. The log needs the thermometer, not the room.',
 '45 CFR 164.530(c)',
 212),

('priv-ma-social', 'medical_assistant', 'prohibited',
 'Post about the shift where it could identify a patient - including "you would not believe today"',
 'Nothing about a patient goes online, even without a name. A small town recognises a description faster than a name.',
 null,
 213),

('priv-ma-family', 'medical_assistant', 'authorized',
 'Speak with a family member who is in the room, when the patient has not objected',
 null, null, 214),

-- ---------- X-ray tech ----------
('priv-xr-images', 'xray_tech', 'prohibited',
 'Show an image to anyone other than the ordering provider and the patient',
 'Say: "The provider will go through the images with you." An image is a record, and a phone screenshot of one leaves the building.',
 '45 CFR 164.502(b)',
 220),

('priv-xr-corridor', 'xray_tech', 'prohibited',
 'Call out a finding or a body part across the department',
 'Take it to the provider directly, or write it. "Room 3''s films are up" carries no clinical information; the alternative does.',
 '45 CFR 164.530(c)',
 221),

-- ---------- Provider ----------
('priv-pr-police', 'provider', 'prohibited',
 'Release information to law enforcement on the strength of a request at the desk',
 'Say: "I''ll need to take that through our medical director." Some disclosures to law enforcement are permitted and many are not, and the difference turns on the paperwork rather than on the urgency in the room.',
 '45 CFR 164.512(f) - specific conditions, not a general permission',
 230),

('priv-pr-minimum', 'provider', 'prohibited',
 'Send a whole record when a specific answer was asked for',
 'Send the part that answers the question. A full chart in reply to "was she seen on Tuesday" is a disclosure nobody needed.',
 '45 CFR 164.502(b) - minimum necessary',
 231),

('priv-pr-emergency', 'provider', 'authorized',
 'Share what is needed for treatment, with another treating clinician, without a signed release',
 null,
 '45 CFR 164.506(c) - treatment, payment and operations',
 232),

-- ---------- Centre administrator ----------
('priv-ca-breach', 'center_admin', 'prohibited',
 'Decide alone that a disclosure was too small to matter',
 'File it under Record an event the same day and take it to the medical director. The clock on a breach notification starts at discovery, not at the point somebody concludes it was serious.',
 '45 CFR 164.404(b) - notification without unreasonable delay and within 60 days',
 240),

('priv-ca-access', 'center_admin', 'prohibited',
 'Leave an account active for somebody who has left',
 'Deactivate them in Team the day they finish. It ends their sessions immediately and revokes any invitation still sitting in their mailbox.',
 '45 CFR 164.308(a)(3)(ii)(C) - termination procedures',
 241),

('priv-ca-request', 'center_admin', 'authorized',
 'Give a patient a copy of their own record on written request',
 null,
 '45 CFR 164.524',
 242)

) as v(key, job_role, kind, item, instead, citation, sort_order)
   where not exists (
           select 1 from staff.scope_items x
            where x.org_slug = p_slug and x.key = v.key
         );

  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function staff.seed_privacy(text) to staff_app;

create or replace function staff.privacy_seed_new_org()
returns trigger language plpgsql as $$
begin
  perform staff.seed_privacy(new.slug);
  return null;
end $$;

drop trigger if exists staff_orgs_seed_privacy on staff.orgs;
create trigger staff_orgs_seed_privacy
  after insert on staff.orgs
  for each row execute function staff.privacy_seed_new_org();

-- And the clinics that already exist. The library org is skipped: it
-- holds templates, not people, and has no front desk to give rules to.
do $$
declare o record;
begin
  for o in select slug from staff.orgs where not is_library and active loop
    perform staff.seed_privacy(o.slug);
  end loop;
end $$;

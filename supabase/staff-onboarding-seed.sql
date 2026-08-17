-- ============================================================
-- STARTER ONBOARDING PACKET
--
-- Run AFTER supabase/staff-onboarding.sql. Idempotent; safe to re-run.
-- Editing a document later means inserting a NEW version row, not
-- changing these — see the immutability note in staff-onboarding.sql.
--
-- TWO KINDS OF DOCUMENT ARE SEEDED HERE, AND THE DIFFERENCE MATTERS.
--
-- PUBLISHED (published_at set) — these state a legal requirement that
-- applies to the staff of any urgent care regardless of who owns it, and
-- cite the rule they come from. What the reader attests to is that they
-- understand the obligation and will work accordingly. Nothing here
-- describes any particular employer's internal procedure, so nothing here
-- is invented on an employer's behalf.
--
-- DRAFT (published_at null) — skeletons for the policies that are
-- genuinely the employer's own: attendance, social media, controlled
-- substances, incident reporting. Their content cannot be guessed and
-- must not be. They are NOT assigned to anyone and no one can sign them
-- until an administrator writes the real text and publishes it. A seeded
-- placeholder presented to staff as their employer's policy would make
-- the resulting signature worthless, which defeats the entire purpose of
-- collecting it.
--
-- These acknowledgements record that someone was informed. They are not a
-- substitute for hands-on training where a regulation requires it — in
-- particular OSHA bloodborne pathogens training under 29 CFR
-- 1910.1030(g)(2) must include an opportunity for interactive questions
-- and answers with a qualified trainer, and Pennsylvania mandated
-- reporter training for licensure must come from an approved provider.
-- ============================================================

insert into staff.policy_docs
  (org_slug, key, version, title, category, citation, summary, body_md,
   attestation, applies_to, renew_months, sort_order, published_at)
values

-- ---------- HIPAA PRIVACY ----------
('afc', 'hipaa-privacy', 1,
 'Patient privacy and the minimum necessary rule',
 'hipaa',
 '45 CFR 164.502(b), 164.514(d), 164.530(b), 164.530(e)',
 'What you may look at, what you may say, and what happens if you look at something you had no reason to see.',
$md$
## Why this exists

The HIPAA Privacy Rule requires every covered entity to train its workforce on
its privacy policies and to apply sanctions when they are broken
(45 CFR 164.530(b) and (e)). This document is that training record for you.

## Minimum necessary

When you use or disclose protected health information, you may only use or
see **the minimum necessary** to do the job in front of you
(45 CFR 164.502(b), 164.514(d)). In practice:

- Open a chart because a task requires it, never out of curiosity.
- Looking up a friend, a neighbour, a family member, a coworker, or yourself
  is a violation even if you change nothing and tell no one.
- Every access is logged. Audits are routine, not a reaction to suspicion.

## Talking about patients

- Not in the waiting room, not in the hallway, not in the elevator, not in the
  parking lot.
- Not to a patient's family member without confirming they are permitted to
  receive it.
- Not on social media, ever — including details you believe are anonymous.
  Town, age, injury, and time of day identify a person in a small community.

## If something goes wrong

Report a suspected privacy incident to your supervisor **the same day**. A
disclosure reported quickly is often containable; the notification duties in
45 CFR 164.400–414 run on a clock. You will not be disciplined for reporting
your own mistake promptly and honestly. You may be disciplined for hiding it.
$md$,
 'I understand the minimum necessary rule, that accessing a record I have no work reason to open is a violation, and that I must report a suspected privacy incident the same day I become aware of it.',
 null, 12, 10, now()),

-- ---------- HIPAA SECURITY ----------
('afc', 'hipaa-security', 1,
 'Logins, devices, and workstation security',
 'hipaa',
 '45 CFR 164.308(a)(5), 164.310(b), 164.310(c)',
 'Your login is you. Everything done with it is attributed to you.',
$md$
## Your credentials are yours alone

The Security Rule requires a security awareness and training program for all
workforce members (45 CFR 164.308(a)(5)). The core of it is simple:

- **Never share a password or badge**, including with a supervisor, and
  including "just for today."
- **Never work under someone else's session.** Every action is attributed to
  the account that performed it. If you use a coworker's login, their name is
  on what you did, and yours is on what they did.
- If you believe someone else has used your account, say so immediately.

## Workstations

Workstation use and security are specifically regulated
(45 CFR 164.310(b), (c)):

- Lock the screen when you step away, every time, including "just a second."
- Turn monitors so they are not readable from the waiting area.
- Do not install software on clinic machines.

## Phones and photos

- No patient information in personal text messages, personal email, or any
  consumer messaging app.
- No photographs inside clinical areas without an explicit clinical reason and
  a supervisor's approval. A photo taken for a legitimate reason still catches
  whatever is on the screen behind it.
- Do not save patient information to a personal device, cloud account, or USB
  drive.

## Email and phishing

Most breaches start with an ordinary-looking email. Confirm unexpected requests
for credentials, payment changes, or patient information through a second
channel before acting — a phone call to a number you already had, not the one
in the message.
$md$,
 'I understand that my login identifies me personally, that I must never share or use another person''s credentials, and that patient information must not be placed on personal devices or accounts.',
 null, 12, 20, now()),

-- ---------- OSHA BLOODBORNE PATHOGENS ----------
('afc', 'osha-bloodborne', 1,
 'Bloodborne pathogens, sharps, and exposure response',
 'osha',
 '29 CFR 1910.1030',
 'Universal precautions, safe sharps handling, and exactly what to do in the first minutes after a needlestick.',
$md$
## Universal precautions

Treat **all** human blood and other potentially infectious material as if it
is infectious (29 CFR 1910.1030(d)(1)). You do not get to decide which
patients warrant precautions, and you cannot tell by looking.

## Personal protective equipment

Gloves for any contact with blood, body fluids, mucous membranes, or broken
skin. Face and eye protection whenever splash or spatter is possible. Gowns
when clothing could be soaked through. Your employer must provide PPE at no
cost to you and must replace it as needed — if it is not available, that is a
problem to raise, not to work around.

## Sharps

- Never recap a needle by hand.
- Activate the safety device immediately, at the point of use.
- Dispose of sharps in an approved container at the point of use. Do not
  carry an unsheathed sharp across a room.
- Never overfill a sharps container or push anything down into one.

## Hepatitis B vaccination

The vaccination series must be offered to you at no cost within 10 working
days of assignment to duties with exposure risk (29 CFR 1910.1030(f)(2)). You
may decline it, and you may change your mind and receive it later at no cost.

## If you are exposed

An exposure is a needlestick, a cut with a contaminated object, or contact of
blood or body fluid with your eyes, nose, mouth, or broken skin.

1. **Wash immediately** — soap and running water for skin; flush eyes or
   mucous membranes with water or saline for several minutes.
2. **Report it immediately**, before the end of your shift, without exception.
   Post-exposure prophylaxis is time-sensitive and its effectiveness falls
   with delay.
3. A confidential medical evaluation and follow-up must be made available to
   you at no cost (29 CFR 1910.1030(f)(3)).
4. The event is recorded on the sharps injury log
   (29 CFR 1910.1030(h)(5)), which does not name you publicly.

You will never be penalized for reporting an exposure. Not reporting one puts
only you at risk.
$md$,
 'I understand universal precautions and safe sharps handling, I know that the hepatitis B vaccination must be offered to me at no cost, and I understand that I must report any exposure immediately and before the end of my shift.',
 null, 12, 30, now()),

-- ---------- OSHA HAZARD COMMUNICATION ----------
('afc', 'osha-hazcom', 1,
 'Chemical safety and hazard communication',
 'osha',
 '29 CFR 1910.1200',
 'Labels, safety data sheets, and where to find them without asking anyone.',
$md$
## The right to know

The Hazard Communication Standard (29 CFR 1910.1200) gives you the right to
know what chemicals you work with and how they can hurt you. It is your
employer's duty to make that information available and yours to use it.

## Labels

Every container must be labelled. A secondary container — a spray bottle you
filled yourself — must be labelled too, with the product identifier and the
hazard. An unlabelled bottle of clear liquid is a hazard on its own.

Pictograms you will see on the products used here: corrosion, exclamation
mark, flame, and health hazard. Learn the four; they carry most of the
meaning at a glance.

## Safety data sheets

An SDS must be readily accessible during every shift, without needing a
password, a supervisor, or a locked cabinet. Find out where they are kept in
your clinic **today**, not on the day you need one. Section 4 is first aid;
section 8 is the protective equipment required.

## Working safely

- Never mix cleaning products. Bleach with ammonia or with acid produces a
  toxic gas, and several common cleaners contain one or the other.
- Follow the contact time on disinfectant labels. A surface wiped dry too
  early has not been disinfected.
- Ventilate as the label directs.

## Spills and exposures

Know where the eyewash station and spill kit are. For a chemical splash to
the eye, flush for 15 minutes and get help — do not stop early because it
feels better. Report every chemical exposure the same way you would report a
bloodborne exposure.
$md$,
 'I know where safety data sheets are kept in my clinic and how to reach them during any shift, I understand secondary containers must be labelled, and I understand I must report chemical exposures.',
 null, 12, 40, now()),

-- ---------- EMERGENCY PROCEDURES ----------
('afc', 'emergency-procedures', 1,
 'Emergency procedures and evacuation',
 'operations',
 '29 CFR 1910.38',
 'What you personally do first — before you look for someone more senior.',
$md$
## Why this is your job, not someone else's

An emergency action plan is required to be reviewed with each employee when
they are assigned to their role (29 CFR 1910.38(f)). The plan only works if
the first person to notice acts, and in an urgent care that is usually
whoever is closest — not whoever is most senior.

## Medical emergency in the building

- Call for help out loud before you do anything else. Do not go looking for
  someone quietly.
- Know where the AED is and that it talks you through its own use.
- Know where the emergency kit and oxygen are kept.
- Someone must meet EMS at the door and bring them in. That job is real and
  is often forgotten.

## Fire

**R.A.C.E.** — Rescue anyone in immediate danger, Alarm, Contain by closing
doors, Extinguish only if the fire is small and you have a clear exit behind
you.

**P.A.S.S.** for an extinguisher — Pull, Aim at the base, Squeeze, Sweep.

Never let a fire get between you and the way out.

## Evacuation

Know the two nearest exits from wherever you are standing. Know the assembly
point outside. Do not use the elevator. Patients in rooms are your
responsibility on the way out — nobody is left because everyone assumed
someone else had checked.

## Violent or threatening person

Distance first, then a door between you and them, then call. Do not attempt
to physically manage a violent person alone. De-escalate with a calm voice
and open hands; give a person a way out of the room rather than blocking it.

## Severe weather and power loss

Move away from glass. Know which outlets are on emergency power and which
refrigerators hold temperature-sensitive stock, because that clock starts the
moment the power does not come back.
$md$,
 'I know the location of the nearest exits, the AED, the fire extinguishers, and the assembly point for my clinic, and I understand my own first actions in a medical emergency, a fire, and an evacuation.',
 null, 12, 50, now()),

-- ---------- MANDATED REPORTING (PENNSYLVANIA) ----------
('afc', 'mandated-reporting-pa', 1,
 'Mandated reporting of suspected abuse (Pennsylvania)',
 'clinical',
 '23 Pa. C.S. § 6311; 35 P.S. § 10225.701 et seq.',
 'You report suspicion directly. You do not need proof, and you do not delegate it.',
$md$
## You are a mandated reporter

Under 23 Pa. C.S. § 6311, individuals who come into contact with children in
the course of their employment in a healthcare facility are **mandated
reporters** of suspected child abuse. This includes clinical and non-clinical
staff who have contact with patients.

## What triggers a report

You must report when you have **reasonable cause to suspect** a child is a
victim of abuse. Three things follow from that wording, and each is the point
where people get it wrong:

- **Suspicion is the standard, not proof.** Investigating is somebody else's
  job. Waiting until you are sure is itself a failure to report.
- **You report personally.** Telling a supervisor does not discharge your
  duty (23 Pa. C.S. § 6311(c)). A mandated reporter who tells a manager and
  assumes it was handled has still not reported.
- **You cannot be prevented from reporting**, and an employer may not
  retaliate against you for making a report in good faith.

## How

ChildLine — **1-800-932-0313**, available 24 hours — or electronically
through the Child Welfare Portal. An oral report is followed by a written
report as the statute requires. Report first, document after.

## Older adults

Pennsylvania's Older Adults Protective Services Act (35 P.S. § 10225.701 et
seq.) imposes reporting duties on employees of covered facilities regarding
suspected abuse, neglect, exploitation, or abandonment of an older adult.
Whether a given urgent care is a covered "facility" is a legal question for
your administrator — ask, and know the answer before you need it. Suspected
abuse of an older adult is reported to the statewide elder abuse hotline at
**1-800-490-8505**.

## Not a substitute for approved training

This acknowledgement records that you understand the duty. Pennsylvania
requires mandated reporter training from an approved provider for many
professional licences; this document does not satisfy that requirement.
$md$,
 'I understand that I am personally a mandated reporter, that reasonable suspicion — not proof — is the standard, that telling a supervisor does not discharge my duty, and that I know how to make a report directly.',
 null, 24, 60, now()),

-- ---------- MASTER ACKNOWLEDGEMENT ----------
('afc', 'employee-acknowledgement', 1,
 'Employee acknowledgement',
 'hr',
 null,
 'The signature that ties the packet together.',
$md$
## What you are signing

You have been given each of the documents in this packet, in full, and had the
opportunity to read them before signing. Each signature is recorded with the
date and time, and with a fingerprint of the exact text you were shown, so
what you agreed to can be produced later exactly as it read on the day.

## What this signature means

- You have read the documents in this packet.
- Where something was unclear, you asked, or you understand that you may ask
  at any time and that asking is expected rather than tolerated.
- You will follow these policies, and you will say so promptly if you cannot,
  rather than working around them quietly.

## What it does not mean

- It is **not** an employment contract and does not change your employment
  status.
- It does **not** waive any right you have, including your right to report a
  safety or legal concern to a regulator.
- It does **not** mean you agree with every policy — only that you have been
  told what they are.

## Keeping it current

Policies change. When a document is revised you will be asked to review the
new version, and your earlier signature stays on file against the version you
originally signed. Some documents renew annually whether or not they have
changed.

You may view and print your own complete compliance record at any time.
$md$,
 'I acknowledge that I have received and read each document in this onboarding packet, that I have had the opportunity to ask questions about them, and that I agree to follow them.',
 null, 12, 999, now())

on conflict (org_slug, key, version) do nothing;

-- ============================================================
-- DRAFTS — the employer's own policies.
--
-- Not assigned, not signable. An administrator replaces the body with the
-- real policy and publishes it. The scaffolding says what the document
-- has to cover, so nobody has to start from a blank page — but no
-- employee is ever shown this text as though it were their employer's
-- rule.
-- ============================================================

insert into staff.policy_docs
  (org_slug, key, version, title, category, summary, body_md, applies_to,
   renew_months, sort_order, published_at)
values

('afc', 'attendance-and-scheduling', 1,
 'Attendance, scheduling, and call-outs', 'hr',
 'DRAFT — replace with your own policy before publishing.',
$md$
> **This is a draft skeleton, not a policy.** It is not assigned to anyone
> and cannot be signed until an administrator replaces this text and
> publishes it.

Cover at minimum:

- Who to notify for an unplanned absence, by what method, and how far ahead.
- Shift start expectations and what counts as late.
- How shift swaps are approved and by whom.
- Time-off requests: how far in advance, and how conflicts are resolved.
- Meal and rest breaks, and what to do when patient volume makes a break
  impossible.
- No-call/no-show consequences, stated plainly.
$md$,
 null, null, 200, null),

('afc', 'social-media-and-photography', 1,
 'Social media, photography, and public statements', 'hr',
 'DRAFT — replace with your own policy before publishing.',
$md$
> **This is a draft skeleton, not a policy.** It is not assigned to anyone
> and cannot be signed until an administrator replaces this text and
> publishes it.

Cover at minimum:

- No patient information on personal accounts, including details you believe
  are de-identified.
- Photography and video inside the clinic: when, with whose approval, on which
  device, and where the file may be stored.
- Whether staff may identify their employer on personal accounts, and any
  disclaimer expected.
- Who may speak to press or respond to online reviews. Reviews are the usual
  trap — a reply confirming that someone was a patient is a disclosure, even
  when the patient posted first.
- Note for whoever drafts this: employees have a legally protected right to
  discuss wages and working conditions with each other, and a policy that
  reads as though it forbids that is unenforceable and creates its own
  liability. Have counsel review the final wording.
$md$,
 null, null, 210, null),

('afc', 'controlled-substances', 1,
 'Controlled substances: storage, counts, and waste', 'clinical',
 'DRAFT — must be written against your own DEA registration before publishing.',
$md$
> **This is a draft skeleton, not a policy.** It is not assigned to anyone
> and cannot be signed until an administrator replaces this text and
> publishes it.

This one cannot be borrowed from anywhere. It has to be written against your
own DEA registration, your state requirements, and your actual physical
setup. Cover at minimum:

- Which schedules are kept on site, and where.
- Who holds keys or access codes, and how that list is kept current.
- Shift-change count procedure, who performs it, and where it is recorded.
- Wastage: two-person witness, documentation, and what happens to a partial
  vial.
- Discrepancy procedure — who is notified, how quickly, and what is not done
  (namely, resolving it quietly).
- Prescription pad and e-prescribing credential security.
- Record retention periods and where the records live.
$md$,
 array['org_admin','clinical_lead']::staff.user_role[], null, 220, null),

('afc', 'incident-reporting', 1,
 'Incident reporting and escalation', 'operations',
 'DRAFT — replace with your own policy before publishing.',
$md$
> **This is a draft skeleton, not a policy.** It is not assigned to anyone
> and cannot be signed until an administrator replaces this text and
> publishes it.

Cover at minimum:

- What counts as an incident: patient injury, staff injury, medication error,
  near miss, equipment failure, privacy event, aggression or threat.
- The form, where it lives, and the deadline for filing it.
- Who is notified immediately versus at the end of shift.
- An explicit non-retaliation statement for good-faith reports, including
  reports of your own error. Without this sentence the rest of the policy
  collects nothing, because people do not report themselves into a
  punishment.
- Who reviews incidents, on what cadence, and how the outcome gets back to
  the person who reported.
$md$,
 null, null, 230, null)

on conflict (org_slug, key, version) do nothing;

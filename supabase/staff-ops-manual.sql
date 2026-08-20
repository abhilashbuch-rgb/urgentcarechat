-- ============================================================
-- THE OPERATIONS MANUAL
--
-- Run AFTER supabase/staff-ethics.sql. Idempotent.
--
-- A separate signed document rather than a section of the code of
-- ethics, because they answer different questions and are read at
-- different moments. The code of ethics is what to do when the rules run
-- out; this is the rules. Somebody looks one of them up in a crisis of
-- conscience and the other one on their third day when they cannot
-- remember who orders the gloves.
--
-- IT IS A SPINE, NOT AN ENCYCLOPAEDIA. The packet already holds eleven
-- policy documents, seven shift logs, eleven emergency guides and a
-- scope of practice per job. Restating any of that here would create two
-- copies that drift, and the copy people happen to read would start
-- being the out-of-date one. So this points at them by name and fills
-- only the gaps nothing else covers — hours, coverage, opening and
-- closing, supplies, retention, and what to do when something breaks.
--
-- RETENTION PERIODS ARE THE PART MOST OFTEN GOT WRONG, so each one below
-- carries its own citation and they are not rounded to a convenient
-- number. Note particularly that the exposure-records period is
-- duration of employment PLUS thirty years, which is far longer than
-- anybody guesses, and that it is the reason a clinic cannot simply
-- purge everything after seven.
--
-- Same substitution mechanism as the code of ethics — resolved once at
-- insert, never at render, because staff.attestations hashes the body
-- and lib/staff/compliance.ts re-verifies that hash against
-- policy_docs.body_md on every read. See the header of staff-ethics.sql
-- for the full reasoning.
--
-- Seeded as a DRAFT. Half of what follows is a placeholder a center
-- administrator must replace with what is actually true of this clinic —
-- its hours, its suppliers, its call rota. Publishing it unedited would
-- put a document full of blanks in front of staff as their employer's
-- operating procedure, so published_at stays null until somebody has
-- been through it.
-- ============================================================

insert into staff.policy_docs
  (org_slug, key, version, title, category, citation, summary, body_md,
   attestation, renew_months, sort_order, applies_to)
select o.slug, 'operations-manual', 1,
  'Operations manual',
  'operations',
  'OSHA recordkeeping, 29 C.F.R. § 1904.33; OSHA access to exposure and medical records, 29 C.F.R. § 1910.1020(d); Bloodborne Pathogens training records, 29 C.F.R. § 1910.1030(h); HIPAA documentation retention, 45 C.F.R. § 164.316(b)(2)',
  'How this center runs day to day, and where to look for everything else.',
  staff.render_org_text(o.slug, $md$
## What this is

The day-to-day operating procedure for **{{center_name}}**. If you need to know
how something is done here, start here. If this document does not answer it,
the last section says where to look.

Everything marked *[to be completed]* has to be filled in by a center
administrator before this is published. A manual with blanks in it is worse
than no manual, because it teaches people that the manual is not maintained.

## Hours and coverage

- Operating hours: *[to be completed]*
- Last patient accepted: *[to be completed]*
- Who opens, and who holds the keys: *[to be completed]*
- Who to call when someone cannot make a shift: *[to be completed]*
- After-hours contact for a building or equipment emergency: *[to be completed]*

**The center does not open without a provider on site.** If the provider is
delayed, the doors stay shut and waiting patients are told honestly how long
it will be — not brought inside to wait in rooms.

## Opening and closing

Both are logged, not remembered. The opening and closing sheets are in this
system under **Logs**, and they are the record — a shift that was worked but
not logged did not happen as far as any inspection is concerned.

Opening covers the drawer count, privacy screens and the lobby walk. Closing
covers drawer reconciliation, the end-of-day PHI sweep, the log book close and
the card batch. The center administrator's day-sheet reconciliation is a
separate sheet from the front desk's closing sheet, deliberately: one person
should not sign for both halves of a money control.

## Who does what

Every person has a job set on their account, and their board only shows the
work that belongs to that job. That is not a display preference — it is the
scope of practice, and it is set out per job under **Rules**.

Two things follow from it that people get wrong:

- **A task not on your board is not yours to do**, however busy it is and
  however capable you are. Ask the person whose board it is on.
- **The narcotics count needs two people**, one counting and one witnessing.
  That is the control. One person doing both is not a faster count, it is no
  count.

## Equipment and supplies

- Ordering, and who approves it: *[to be completed]*
- Preferred suppliers and account numbers: *[to be completed]*
- Where the par levels are kept: *[to be completed]*
- Biomedical / calibration contractor: *[to be completed]*
- Who to call for the refrigerator, the autoclave, the X-ray unit:
  *[to be completed]*

**Anything out of range gets tagged before it gets reported.** A refrigerator
reading warm is taken out of service with a DO NOT USE tag and the stock
quarantined — not discarded — before anybody makes a phone call. Discarding
vaccine before the manufacturer has been asked is how a recoverable excursion
becomes a loss.

## Records, and how long they are kept

These periods are federal minimums. {{state}} may require longer, and where it
does, the longer period wins.

- **OSHA 300 log, 300A summary and 301 incident reports — five years** beyond
  the year they cover. *(29 C.F.R. § 1904.33.)*
- **Employee exposure records and medical records — duration of employment
  plus thirty years.** *(29 C.F.R. § 1910.1020(d).)* This is the one nobody
  expects, and it is why a general "purge after seven years" rule is unsafe.
- **Bloodborne pathogens training records — three years** from the date of
  training. *(29 C.F.R. § 1910.1030(h)(2)(ii).)*
- **HIPAA policies, and documentation of actions and assessments required by
  the Security Rule — six years** from creation or last effective date.
  *(45 C.F.R. § 164.316(b)(2).)*
- **Patient records — set by {{state}} law**, not by federal rule, and the
  period differs for minors. *[to be completed: the period for {{state}},
  confirmed with counsel.]*

Nothing recorded in this system is deleted or edited. Corrections are made as
amendments that sit alongside the original, which is why there is no delete
button anywhere in it.

## Money

- Cash drawer float and where it is held: *[to be completed]*
- Who prepares and who takes the deposit: *[to be completed]*
- Deposit frequency: *[to be completed]*

**The person who counts is not the person who reconciles**, wherever staffing
allows it. Where it does not, the variance is written down and initialled by
the second person the next morning rather than resolved quietly.

A variance is reported the day it is found. A shortfall found and reported is
a reconciliation; the same shortfall found later by somebody else is an
investigation.

## When something goes wrong

- **A patient safety event, an injury, or a near miss** is an incident report,
  filed the same day, under the incident reporting policy in this packet. Near
  misses count. They are the cheapest information this center will ever get.
- **A privacy breach, or a suspected one** — including an email to the wrong
  address — goes to the privacy officer immediately, not after somebody has
  worked out how serious it was. Breach notification runs on a clock that
  starts at discovery.
- **Equipment failure** is logged and tagged before the shift ends, even when
  a workaround was found.
- **Anything you are unsure about** goes to {{medical_director}} or a center
  administrator. Asking is expected here, not tolerated.

Nobody is penalised for reporting something in good faith. That is stated in
the code of ethics and it is meant literally.

## Where everything else lives

| What you need | Where it is |
|---|---|
| What your job may and may not do | **Rules** |
| Today's shift checks | **Logs** |
| Walked runbooks, signed at the end | **Rounds** |
| Anaphylaxis, code blue, needlestick, eye splash | **Learning** |
| Your own license and certification dates | **My documents** |
| The clinic's own protocols, searchable | **Protocols** |
| Deadlines and who owns them | **Obligations** |
| What to do when the rules run out | **Code of ethics** |

## Keeping this true

This manual is reviewed at least annually and whenever something in it
changes. A center administrator owns it. If you find something in here that is
no longer how the center works, say so — a manual nobody corrects becomes a
manual nobody reads, and then it becomes evidence of what the center said it
did rather than what it did.
$md$),
  'I have read this operations manual and I understand how this center runs. Where it did not answer something, I know where to look and who to ask.',
  12,
  6,
  null
from staff.orgs o
where not exists (
  select 1 from staff.policy_docs d
   where d.org_slug = o.slug and d.key = 'operations-manual' and d.version = 1
);

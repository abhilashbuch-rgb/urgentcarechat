-- ============================================================
-- END OF DAY: THE LOG BOOK CLOSE AND THE DAY SHEET
--
-- Run AFTER supabase/staff-job-roles-seed.sql. Idempotent.
--
-- Built from a real practice-management end-of-day checklist. The
-- substance is kept exactly; the VENDOR NAMES ARE NOT. The source
-- names one PM system, one clearinghouse and one card-terminal app by
-- brand, and hard-coding those into the default set every clinic
-- receives would ship a checklist that is wrong for any clinic on a
-- different stack — which is most of them. So the fields say "your PM
-- system", "the card terminal", "the clearinghouse", and the specific
-- products appear only as "e.g." inside help text an administrator can
-- edit. A clinic on that exact stack loses nothing; a clinic on another
-- one is not told to click a menu it does not have.
--
-- WHY TWO FORMS AND NOT ONE. The source is a single sheet, but it has
-- two owners: the log book is the front desk's work, and the money
-- reconciliation is the center administrator's. Filing them together
-- would mean one person signs an attestation covering the other's work,
-- which is precisely the thing a signature is supposed to prevent.
--
-- WHY NOT A ROUND. Rounds are WALKED — one step at a time with the next
-- hidden, because a physical walk can otherwise be satisfied from the
-- counter. Nothing here is a walk: every line produces a NUMBER (how
-- many visits are still open, what the batch totalled), and a number is
-- its own evidence. So these are forms, which means the counts run
-- through the same min/max evaluation every other log uses and an
-- out-of-range value forces a corrective action before it can be filed.
--
-- THE COUNTS THAT MUST BE ZERO ARE max: 0, NOT min/max 0..0. Zero
-- duplicate visits is the only acceptable answer at close; one is an
-- excursion and gets the same treatment a warm fridge does — the log
-- still files, but not without saying what was done about it. That is
-- deliberate: a front desk that cannot file an honest "we found two"
-- learns to file a dishonest zero.
-- ============================================================

insert into staff.form_templates
  (org_slug, slug, name, description, category, frequency, slots, sort_order,
   job_roles, schema_json)
select o.slug, t.slug, t.name, t.description, t.category, t.frequency,
       t.slots, t.sort_order, t.job_roles, t.schema_json::jsonb
from staff.orgs o
cross join (values

  ('front-desk-eod',
   'End of day — log book',
   'Every visit closed out, eligibility run, nothing duplicated.',
   'operations', 'daily', array['pm'], 96,
   array['front_desk','center_admin']::staff.job_role[],
   $json$
   {
     "standard": "Every visit on today's log carries a final status, every eligibility check has run, and no patient appears twice. A visit left open tonight is a claim nobody can bill tomorrow.",
     "fields": [
       { "id": "not_seen", "label": "Logged but not seen", "type": "number",
         "min": 0, "step": 1, "presets": [0, 1, 2, 3, 4],
         "help": "No-show, cancelled, rescheduled, or walked out. Count them first — each one needs an arrival status before it can be closed." },
       { "id": "not_seen_closed", "label": "Each one given an arrival status and timed out", "type": "boolean",
         "expected": true,
         "help": "Time out the visit on the log detail page. If a chart was already created, discharge it as left-without-being-discharged instead — no time-out needed, and it will not count against the visit." },
       { "id": "rte_open", "label": "Visits with no eligibility result", "type": "number",
         "min": 0, "max": 0, "step": 1, "presets": [0, 1, 2, 3],
         "help": "Skip workers' comp and occupational visits — eligibility does not apply to them and they are not a problem." },
       { "id": "rte_blocker", "label": "If any are still open, what is blocking them", "type": "select",
         "options": ["None remain", "Subscriber not found", "Payer setup incomplete", "Payer system unavailable"],
         "required": false,
         "help": "Subscriber-not-found is usually a member ID or date-of-birth typo — fix and re-run before assuming the coverage is bad. Payer setup means the eligibility payer ID is missing; it is often the claims payer ID but not always, so look it up in the clearinghouse rather than guessing." },
       { "id": "selfpay_closed", "label": "Self-pay charges entered, and balance taken or billed to the patient", "type": "boolean",
         "expected": true, "required": false,
         "help": "Best done while the patient is still at the desk. Billing the balance sends them a statement; leaving it does neither." },
       { "id": "duplicates", "label": "Duplicate visits on the log", "type": "number",
         "min": 0, "max": 0, "step": 1, "presets": [0, 1, 2],
         "help": "Sort by patient name and read down the column. Two rows for one person becomes two claims." },
       { "id": "open_status", "label": "Visits not in a final status", "type": "number",
         "min": 0, "max": 0, "step": 1, "presets": [0, 1, 2, 3],
         "help": "Final means signed, discharged, or checked out. Anything else is still open." },
       { "id": "open_status_kind", "label": "If any remain, where are they stuck", "type": "select",
         "options": ["None remain", "Charting", "Log pending", "Logged, not timed out", "Discharged, awaiting results"],
         "required": false,
         "help": "Charting should be discharged. A pending log is either completed or deleted — deleted only if it was a duplicate or an error. A logged visit gets timed out, which moves it to checkout. Discharged-awaiting-results is legitimate and needs no action tonight." }
     ]
   }
   $json$),

  ('admin-day-sheet',
   'End of day — day sheet and card batch',
   'Printed day sheet reconciled against the terminal batch.',
   'operations', 'daily', array['pm'], 97,
   array['center_admin']::staff.job_role[],
   $json$
   {
     "standard": "The day sheet and the card batch agree tonight, or the variance gets found tomorrow with no shift to pin it to. Cash and the drawer are counted on the front desk closing sheet, not here.",
     "fields": [
       { "id": "day_sheet_printed", "label": "Day sheet printed", "type": "boolean",
         "expected": true },
       { "id": "day_sheet_card_total", "label": "Card total on the day sheet", "type": "number",
         "unit": "USD", "min": 0, "step": 0.01,
         "help": "Card payments only. Cash and checks are reconciled on the front desk closing sheet." },
       { "id": "terminal_batch_total", "label": "Card terminal batch total", "type": "number",
         "unit": "USD", "min": 0, "step": 0.01,
         "help": "From the terminal's current-batch report (e.g. PaymentMate: right-click the tray icon, Manager Functions, Credit Card, Current Batch)." },
       { "id": "batch_matches", "label": "The two totals match", "type": "boolean",
         "expected": true,
         "help": "If they do not, say what you found and what you did. A variance recorded honestly is a reconciliation; a variance left silent is what an audit finds first." },
       { "id": "batch_closed", "label": "Terminal batch closed for the day", "type": "boolean",
         "expected": true,
         "help": "An unclosed batch settles late or not at all, and the money shows up on the wrong day." },
       { "id": "receipts_filed", "label": "Signed receipts kept with the day sheet", "type": "boolean",
         "expected": true, "required": false,
         "help": "Only if signed copies are part of your workflow. Leave it if they are not." }
     ]
   }
   $json$)

) as t(slug, name, description, category, frequency, slots, sort_order, job_roles, schema_json)
where not exists (
  select 1 from staff.form_templates f
   where f.org_slug = o.slug and f.slug = t.slug
);

-- WHY THERE IS NO "UPDATE THE TEMPLATE" STATEMENT HERE.
-- Re-running this file will not rewrite a template that already exists,
-- and that is deliberate. A template is DATA so a clinic can correct it
-- — change a label, drop a field that does not apply, add one that
-- does. A migration that overwrote schema_json on every run would throw
-- those edits away on the next deploy, which is the one failure that
-- would teach an administrator never to customise anything again.
-- Corrections to the shipped wording ship as a NEW migration naming the
-- exact field, the way staff-log-presets.sql patches a single field by
-- id rather than replacing the row.

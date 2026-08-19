-- ============================================================
-- THE CODE OF ETHICS
--
-- Run AFTER supabase/staff-onboarding-seed.sql. Idempotent.
--
-- There was no code of ethics in the packet. Eleven policy documents
-- covered privacy, bloodborne pathogens, hazard communication, mandated
-- reporting, controlled substances and incident reporting — every one of
-- them a rule about a PROCEDURE. None of them said what the clinic is
-- for, or what to do when doing the right thing costs money. That gap is
-- the one every compliance program is judged on after something has
-- gone wrong.
--
-- ---------------------------------------------------------------
-- WHY THE CENTER'S NAME IS SUBSTITUTED AT INSERT, NOT AT RENDER
-- ---------------------------------------------------------------
-- The obvious design is a template with {{center_name}} in it, resolved
-- when the page is drawn. It would be wrong here, and the reason is two
-- lines away in the schema.
--
-- staff.attestations stores body_sha256 — "sha256 of body_md exactly as
-- rendered to this person" — and lib/staff/compliance.ts RECOMPUTES that
-- hash on every read, in SQL, directly over policy_docs.body_md, to
-- prove the signed text has not been altered since. Substituting at
-- render time would mean the stored hash was taken over resolved text
-- while the verification hash is taken over the raw template. They would
-- never match again, and every signature in the system would display as
-- tampered with, permanently.
--
-- So the placeholders are resolved HERE, once, as each org's own row is
-- created. Every clinic gets a concrete document with its own name in
-- it, which it then owns and can edit freely — body_md is data.
--
-- That also happens to be the correct behavior for a signed document.
-- If the center is renamed, the text somebody signed still says what it
-- said on the day. Reflecting the new name is a NEW VERSION requiring a
-- fresh acknowledgement, which the (org_slug, key, version) key and the
-- supersedes_id chain already model. A signed policy that silently
-- rewrites itself is not a record.
--
-- ---------------------------------------------------------------
-- WHAT THIS DOCUMENT IS AND IS NOT
-- ---------------------------------------------------------------
-- Every legal citation below is exact and is to federal law that applies
-- to essentially any US clinic billing a federal program. Where a duty
-- is a PRACTICE RULE rather than a statute it says so in the text, in
-- the same sentence, because a code of ethics that dresses house rules
-- up as law teaches staff to disbelieve the parts that really are law.
--
-- EMTALA IS DELIBERATELY NOT CLAIMED. A freestanding urgent care center
-- is generally NOT a dedicated emergency department under 42 CFR 489.24
-- and generally not subject to EMTALA; a hospital-owned one may be. The
-- duty to stabilize and transfer is therefore stated as an ETHICAL
-- obligation of the clinic, with a note that statutory applicability
-- depends on ownership — rather than asserting a legal duty that may not
-- exist for the reader, or omitting the duty because the statute might
-- not bind.
--
-- NO VENDOR IS NAMED, here or anywhere in the packet. This is meant to
-- read as a universal standard of practice; a standard that name-checks
-- a supplier reads as that supplier's documentation instead.
--
-- SEEDED AS A DRAFT (published_at null), like every other document in
-- the packet. An unpublished document is assigned to nobody. A medical
-- director reads it, edits what should differ for this clinic, and
-- publishes it — because a code of ethics nobody in the building chose
-- is a poster, not a commitment.
-- ============================================================


-- ---------- The substitution helper ----------
--
-- Available to any future document that wants it. Deliberately tiny and
-- deliberately not clever: it does not parse, it replaces four known
-- tokens. An unresolved token would render literally as {{...}} in a
-- signed document, so each has a fallback that reads as a prompt rather
-- than as a mistake.
create or replace function staff.render_org_text(p_org text, p_text text)
returns text
language sql stable
as $$
  select replace(replace(replace(replace(
           p_text,
           '{{center_name}}',  coalesce(o.name, 'this center')),
           '{{legal_entity}}', coalesce(o.legal_entity, o.name, 'this center')),
           '{{state}}',        coalesce(o.state, 'the state in which it operates')),
           '{{medical_director}}',
                               coalesce(o.medical_director_name,
                                        'the medical director'))
    from staff.orgs o
   where o.slug = p_org
$$;

revoke all on function staff.render_org_text(text, text) from public;
grant execute on function staff.render_org_text(text, text) to staff_app;


-- ---------- The document ----------

insert into staff.policy_docs
  (org_slug, key, version, title, category, citation, summary, body_md,
   attestation, renew_months, sort_order, applies_to)
select o.slug, 'code-of-ethics', 1,
  'Code of ethics',
  'operations',
  'Anti-Kickback Statute, 42 U.S.C. § 1320a-7b(b); Physician Self-Referral (Stark), 42 U.S.C. § 1395nn; False Claims Act, 31 U.S.C. §§ 3729-3733; HIPAA Privacy Rule, 45 C.F.R. Part 164',
  'What this center is for, and what to do when the right call is the expensive one.',
  staff.render_org_text(o.slug, $md$
## Why this exists

Every other document in this packet tells you how to do something. This one
says what to do when the rules run out, or when two of them point in different
directions, or when the right answer costs the center money.

It is short on purpose. A code nobody can remember is a code nobody uses.

## The one that decides the others

**The patient in front of you comes before the schedule, the door count, and
the revenue.** Everything below is a consequence of that sentence.

If you are ever told, by anyone, to do something that contradicts it, you are
expected to say so — and this document is what you point at.

## Care

- **Work inside your license and your training.** Not near the edge of it, not
  just past it because the center is busy. If you are not qualified to do a
  thing, the correct answer is to find the person who is, even when that is
  slower. Your scope is set out in your own brief; when it is unclear, ask
  before acting rather than after.
- **Nobody is turned away, hurried, or treated differently** because of who
  they are, what they can pay, how they are insured, what language they speak,
  or how they have behaved in the past.
- **Emergencies get stabilized and moved, not queued.** If someone needs a
  level of care this center cannot give, they are stabilized to the limit of
  what is available here and transferred without waiting for payment
  questions to be resolved. *(Whether this is also a statutory duty depends on
  how this center is owned — a hospital-owned site may fall under EMTALA,
  42 C.F.R. § 489.24, while a freestanding one generally does not. It is a duty
  here regardless of which applies.)*
- **A patient may refuse care, and may ask what something costs first.**
  Neither is a reason to treat them worse.

## Records

- **Chart what happened. Never chart what did not.** A note describing an
  examination nobody performed is a false record whatever the intention behind
  it, and it is the single fastest way to turn a clinical question into a legal
  one.
- **Write it when it happens**, or say plainly when you are writing late. A
  late entry that admits to being late is honest; one backdated to look
  contemporaneous is not.
- **A mistake gets corrected, never erased.** Amend, and say what changed and
  why. This applies to paper and to this system alike — which is why nothing
  here has a delete button.

## Money

These are federal criminal and civil statutes, not house rules.

- **Nothing of value is given or accepted in exchange for referrals.** Not
  cash, not rent below market, not free staff, not a share of what a referral
  earns. *(Anti-Kickback Statute, 42 U.S.C. § 1320a-7b(b) — a criminal
  statute; violations can also become False Claims Act liability.)*
- **Referrals go where the patient is best served**, never to an entity you or
  a family member has a financial interest in without that interest being
  disclosed and permitted. *(Stark, 42 U.S.C. § 1395nn, governs designated
  health services and physician financial relationships.)*
- **Bill for what was done, at the level it was done.** Not the level that
  pays better, not a bundle unbundled to earn more, not a service that did not
  happen. *(False Claims Act, 31 U.S.C. §§ 3729-3733.)*
- **Clinical decisions are not made on the basis of what a visit pays.** If
  you are ever asked to add a test, a level, or a follow-up for a reason that
  is financial rather than clinical, that is a report under the section below.
- **Declare gifts and hospitality from suppliers** to {{medical_director}} or a
  center administrator. A working lunch is not a scandal; the point of
  declaring it is that nobody has to guess later whether it was.

## Privacy

- **Look at a record only when you have a reason to be in it.** Curiosity about
  a neighbour, a colleague, a relative, or someone in the news is not a reason,
  and access is logged. *(HIPAA Privacy Rule, 45 C.F.R. Part 164.)*
- **What you learn here does not leave here.** Not to family, not in a car
  park, not on social media in a form you believe is anonymous. The details
  that make a story worth telling are usually the details that identify
  somebody.

## Each other

- **Say the thing early.** A concern raised while something can still be fixed
  is worth more than a perfect account of it afterwards.
- **Nobody is punished for raising a concern in good faith.** Retaliating
  against someone for reporting is itself a breach of this code, and several
  of the statutes above carry their own whistleblower protections. Being wrong
  in good faith is fine. Staying quiet because it was awkward is not.
- **You may report to {{medical_director}} or to any center administrator.** If
  the concern is about the person you would normally tell, tell the other one.

## When this is hard

The situations this document exists for do not announce themselves. They look
like a busy afternoon and a small shortcut. Three questions, in order:

1. Would I be comfortable if the patient could see exactly what I did and why?
2. Would I be comfortable explaining this to a surveyor in two years, from the
   record as it will read then?
3. Am I about to do this because it is right, or because it is quicker?

If any answer is uncomfortable, stop and ask someone. Asking is expected here,
not tolerated.

## Status of this document

This is the code of ethics of **{{center_name}}**, operating as
{{legal_entity}} in {{state}}. It is reviewed at least annually and whenever
the law it cites changes.

It is not a substitute for legal advice, and it does not restate every
obligation that applies to this center — the packet's other documents, your
own license, and {{state}} law all continue to apply on their own terms.
$md$),
  'I have read this code of ethics, I understand it, and I agree to work by it. I understand that I am expected to raise a concern if I see something that conflicts with it, and that I will not be penalised for doing so in good faith.',
  12,
  5,
  null
from staff.orgs o
where not exists (
  select 1 from staff.policy_docs d
   where d.org_slug = o.slug and d.key = 'code-of-ethics' and d.version = 1
);

import type { StaffSql } from "@/lib/staff/db";
import { rulesFor } from "@/lib/staff/rules";

// A surveyor's interview is a handful of "what would you do if"
// questions asked on the floor, not a quiz on the manual. What decides
// whether it goes well is whether the person answers it the way this
// clinic's own rules say to.
//
// SO THE ANSWER COMES FROM THE SAME ROWS staff.rules ALREADY READS (see
// app/staff/rules/page.tsx), not a second, hand-written copy of the
// rule that could quietly say something different. Only the QUESTION is
// authored here — the kind of thing a surveyor actually asks — and it
// is paired with a directive or scope-of-practice key already seeded in
// staff-job-roles-seed.sql / staff-scope-seed.sql. If an operator edits
// or removes that row, the question it backs disappears with it rather
// than showing a stale answer.

export interface InterviewQA {
  question: string;
  answer: string;
  rationale: string | null;
  citation: string | null;
}

type Lookup =
  | { kind: "directive"; key: string; question: string }
  | { kind: "scope"; key: string; question: string }
  | { kind: "static"; question: string; answer: string };

const QUESTIONS: Record<string, Lookup[]> = {
  front_desk: [
    {
      kind: "directive",
      key: "escalate-emergency",
      question: "A patient in your lobby looks like they're deteriorating. What do you do?",
    },
    {
      kind: "scope",
      key: "fd-p-triage",
      question:
        "A patient at the window describes chest pain and asks if it's serious enough to be seen right away. What do you tell them?",
    },
    {
      kind: "scope",
      key: "fd-p-treatment",
      question: "A patient asks whether they really need the test the provider ordered. How do you answer?",
    },
    {
      kind: "scope",
      key: "fd-p-findings",
      question: "A patient asks you to just say whether their result “looked normal.” What do you say?",
    },
    {
      kind: "directive",
      key: "verify-identity",
      question: "How do you make sure you've pulled up the right patient's chart at check-in?",
    },
    {
      kind: "directive",
      key: "phi-in-chat",
      question: "Would you ever type a patient's name or date of birth into this app?",
    },
  ],
  medical_assistant: [
    {
      kind: "scope",
      key: "ma-p-interpret",
      question: "A patient asks what their test result means. What do you say?",
    },
    {
      kind: "scope",
      key: "ma-p-phone-advice",
      question: "A patient calls asking whether their symptom means they should come in. How do you handle the call?",
    },
    {
      kind: "directive",
      key: "fridge-excursion",
      question: "Walk me through what you do if the vaccine fridge reads outside range.",
    },
    {
      kind: "directive",
      key: "poct-control-fail",
      question: "Your point-of-care test control fails. Can you still report a patient result from that lot?",
    },
    {
      kind: "directive",
      key: "mdv-28-day",
      question: "How do you know when an opened multi-dose vial has to be discarded?",
    },
    {
      kind: "scope",
      key: "ma-p-unordered",
      question: "Can you perform a test you think is a good idea even though the provider didn't order it?",
    },
  ],
  xray_tech: [
    {
      kind: "scope",
      key: "xr-p-interpret",
      question: "A patient asks if their X-ray shows anything broken. What do you tell them?",
    },
    {
      kind: "scope",
      key: "xr-p-pregnancy",
      question: "A patient isn't sure if they're pregnant and needs an X-ray. What's your call?",
    },
    {
      kind: "directive",
      key: "apron-defect",
      question: "You find a crack in a lead apron. What happens to it?",
    },
    {
      kind: "directive",
      key: "repeat-image-justify",
      question: "How do you document a repeat exposure?",
    },
    {
      kind: "scope",
      key: "xr-p-unordered-view",
      question: "Can you add an extra view you think would help, without checking with the provider first?",
    },
  ],
  center_admin: [
    {
      kind: "directive",
      key: "monthly-oversight",
      question: "How do you know your monthly compliance review actually happened, not just got signed?",
    },
    {
      kind: "static",
      question: "How do you know right now if anyone on staff is missing a required credential?",
      answer:
        "The Credentialing matrix on this page: a red cell is expired or missing, amber is expiring within 90 days, sorted by staff member so nothing is waiting to be found in an individual profile.",
    },
    {
      kind: "static",
      question: "Can you produce the last 90 days of logs for this clinic on request?",
      answer:
        "Yes — the Evidence binder above exports 90 days of logs, the signed policy packet, the credential register and the temperature curve as one bookmarked PDF, generated on demand.",
    },
    {
      kind: "static",
      question: "If I need to review your records without staff walking me through the software, can that be arranged?",
      answer:
        "Yes — Surveyor access above issues a read-only, time-limited link. No login is required and it can be revoked mid-visit.",
    },
    {
      kind: "directive",
      key: "escalate-emergency",
      question: "What's the rule for any staff member, regardless of job, who sees a patient deteriorating?",
    },
  ],
};

/** The interview template for one job, answered from this org's own
 *  directives and scope rows. Returns fewer questions than QUESTIONS
 *  lists when a row it depends on has been deactivated or deleted,
 *  never a question with no real answer behind it. */
export async function interviewPrepFor(
  sql: StaffSql,
  jobRole: string
): Promise<InterviewQA[]> {
  const questions = QUESTIONS[jobRole];
  if (!questions) return [];

  const rules = await rulesFor(sql, jobRole);
  const byDirectiveKey = new Map(rules.directives.map((d) => [d.key, d]));
  const byScopeKey = new Map(
    [...rules.authorized, ...rules.prohibited].map((s) => [s.key, s])
  );

  const out: InterviewQA[] = [];
  for (const q of questions) {
    if (q.kind === "static") {
      out.push({ question: q.question, answer: q.answer, rationale: null, citation: null });
      continue;
    }
    if (q.kind === "directive") {
      const d = byDirectiveKey.get(q.key);
      if (d) out.push({ question: q.question, answer: d.body, rationale: d.rationale, citation: d.citation });
      continue;
    }
    const s = byScopeKey.get(q.key);
    if (s?.instead) out.push({ question: q.question, answer: s.instead, rationale: null, citation: s.citation });
  }
  return out;
}

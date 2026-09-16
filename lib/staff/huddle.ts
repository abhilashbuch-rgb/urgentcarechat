import type { StaffSql } from "@/lib/staff/db";
import { renderHuddleEmailHtml, renderEmailHtml, type EmailSection } from "@/lib/staff/email-html";
import { jobLabel } from "@/lib/staff/roles";
import { dayOfYear } from "@/lib/staff/history-facts";
import { listBulletins } from "@/lib/staff/bulletins";
import { SLOT_LABELS } from "@/lib/staff/forms";

// The morning huddle: one email at the start of the day, to the people
// actually scheduled to work it. See supabase/staff-morning-huddle.sql
// for huddle_at (the per-org send time) and app/api/cron/alerts/route.ts
// for where it is sent from. No opt-out — see that file's header.
//
// PER PERSON, NOT PER ORG. The AM/PM digest (digestFor, above this file
// in lib/staff/alerts.ts) is one message about the whole clinic; this is
// "your day," which means the agenda has to be scoped to the one job the
// reader actually holds — the same scoping shiftState() already uses on
// the Today page, so what this says and what they see when they open the
// app cannot disagree.

// One line to open the day with, drawn from Charaka and Sushruta — the
// physicians whose names are on the two oldest surviving Sanskrit
// medical texts, Charaka Samhita and Sushruta Samhita (roughly 1st–2nd
// century CE), on prevention, diet, sleep, and the physician's own
// conduct toward a patient. Kept close to the most commonly-cited
// English rendering of each line rather than one scholar's exact
// wording — translations vary — but every line traces to a real,
// checkable text, not an invented sentiment. Same rotation rule as
// factOfTheDay() in lib/staff/history-facts.ts, and the same CURATED,
// NOT GENERATED bar that file's own note explains.
const QUOTES: string[] = [
  "Health is known as happiness; disease is known as unhappiness. — Charaka",
  "It is more important to prevent the occurrence of disease than to seek its cure. — Charaka",
  "Under a skilled physician, even severe disorders can vanish quickly; under an unskilled one, even the simplest may grow worse. — Charaka",
  "A life can be lengthened or shortened by nothing more than how it is lived. — Charaka",
  "Happiness, strength, and a long life all depend on proper rest. — Charaka",
  "Not for gain, not for any desire of your own — treat every patient solely for their good. — Charaka",
  "Knowledge without real understanding cannot treat a single patient. — Charaka",
  "Compassion for the suffering is the first duty of anyone who treats them. — Charaka",
  "A balanced appetite, steady digestion, and a calm mind — that is what health actually is. — Charaka",
  "A physician who treats without truly understanding the patient walks without a guide. — Sushruta",
  "Food, taken well, is the root of health; taken carelessly, the root of disease. — Sushruta",
  "Surgery, done with skill and care, restores what disease has taken. — Sushruta",
];

/** Same idea as factOfTheDay(), a second rotation offset so the quote
 *  and the history fact don't happen to line up on the same index every
 *  day — cosmetic, not load-bearing. */
export function quoteOfTheDay(timezone: string, now: Date = new Date()): string {
  let day: number;
  try {
    day = dayOfYear(now, timezone);
  } catch {
    day = dayOfYear(now, "UTC");
  }
  return QUOTES[(day + 3) % QUOTES.length];
}

export interface HuddleRecipient {
  userId: string;
  email: string;
  legalName: string | null;
  jobRole: string | null;
}

/** Everyone who gets today's huddle: active, and scheduled to work
 *  today by their own workdays — no preference to check, same as an
 *  excursion alert has none. The isodow check is identical to
 *  onDutyToday()'s in lib/staff/roster-today.ts; kept separate because
 *  that function returns a display roster grouped by role, and this one
 *  returns individual send targets — different enough shapes that
 *  sharing one function would mean one of the two callers unpacking
 *  data it doesn't want. */
export async function huddleRecipientsToday(
  sql: StaffSql,
  org: string
): Promise<HuddleRecipient[]> {
  return sql<HuddleRecipient[]>`
    select u.id as "userId", u.email, u.legal_name as "legalName", u.job_role as "jobRole"
      from staff.users u
      join staff.orgs o on o.slug = u.org_slug
     where u.org_slug = ${org}
       and u.active
       and u.job_role is not null
       and extract(isodow from (now() at time zone o.timezone))::smallint = any (u.workdays)
     order by u.legal_name
  `;
}

const labelFor = (name: string, slot: string) => (slot ? `${name} (${slot.toUpperCase()})` : name);

interface OutstandingTask {
  name: string;
  slot: string;
}

/** What's still open for one person's job, right now — the same split
 *  huddleFor() and followUpFor() both need, so a noon check-in and the
 *  8am huddle can never disagree about what "still due" means. */
async function outstandingTasks(
  sql: StaffSql,
  org: string,
  jobRole: string | null
): Promise<{ late: OutstandingTask[]; dueOnly: OutstandingTask[] }> {
  const outstanding = await sql<OutstandingTask[]>`
    select name, slot from staff.todays_logs
     where org_slug = ${org}
       and staff.brief_matches(job_roles, ${jobRole}::staff.job_role)
       and response_id is null
     order by sort_order, slot
  `;
  const late = await sql<OutstandingTask[]>`
    select name, slot from staff.overdue_today
     where org_slug = ${org}
       and staff.brief_matches(job_roles, ${jobRole}::staff.job_role)
     order by slot, name
  `;
  const lateKeys = new Set(late.map((l) => `${l.name}:${l.slot}`));
  const dueOnly = outstanding.filter((o) => !lateKeys.has(`${o.name}:${o.slot}`));
  return { late, dueOnly };
}

/**
 * The good-morning email for one person: a greeting, their own agenda
 * for the day (scoped to their job, same as shiftState()'s Today-page
 * count), whatever the center admin posted recently, and a quote.
 *
 * NO SEPARATE "NEWSLETTER" SECTION. This email — greeting, agenda,
 * center-admin notes, quote — IS the day's newsletter; inventing a
 * fifth block of content with nothing real to put in it would mean
 * generating filler, which is exactly what history-facts.ts's own
 * "curated, not generated" rule exists to rule out.
 */
export async function huddleFor(
  sql: StaffSql,
  org: string,
  recipient: HuddleRecipient,
  timezone: string,
  facilityType: string | null
): Promise<{ subject: string; body: string; html: string }> {
  const { late, dueOnly } = await outstandingTasks(sql, org, recipient.jobRole);

  const notes = await listBulletins(sql, 3);
  const quote = quoteOfTheDay(timezone);
  const first = (recipient.legalName ?? "there").split(" ")[0];
  const roleLabel = recipient.jobRole ? jobLabel(recipient.jobRole, facilityType) : null;
  const agendaHeading = roleLabel ? `Today's agenda — ${roleLabel}` : "Today's agenda";

  const lines = [
    `Good morning, ${first}.`,
    "",
    `${agendaHeading}:`,
    ...(late.length + dueOnly.length === 0
      ? ["  Nothing due for you right now."]
      : [
          ...late.map((t) => `  LATE — ${labelFor(t.name, t.slot)}`),
          ...dueOnly.map((t) => `  DUE — ${labelFor(t.name, t.slot)}`),
        ]),
  ];
  if (notes.length > 0) {
    lines.push("", "Notes from the center admin:");
    for (const n of notes) lines.push(`  "${n.body}" — ${n.author_name ?? n.author_email}`);
  }
  lines.push("", quote);

  const html = renderHuddleEmailHtml({
    firstName: first,
    org,
    agendaHeading,
    rows: [
      ...late.map((t) => ({ task: t.name, time: SLOT_LABELS[t.slot] ?? t.slot.toUpperCase(), status: "Late" as const })),
      ...dueOnly.map((t) => ({ task: t.name, time: SLOT_LABELS[t.slot] ?? t.slot.toUpperCase(), status: "Due" as const })),
    ],
    notes: notes.map((n) => ({ body: n.body, author: n.author_name ?? n.author_email })),
    quote,
    timezone,
  });

  return {
    subject: `Good morning, ${first} — ${org}`,
    body: lines.join("\n"),
    html,
  };
}

export type FollowUpTier = "noon" | "afternoon";

const FOLLOWUP_COPY: Record<FollowUpTier, { label: string; intro: (first: string) => string }> = {
  noon: {
    label: "SECOND NOTICE",
    intro: (first) => `${first}, it's midday and this still is not done. Finish it now.`,
  },
  afternoon: {
    label: "FINAL NOTICE",
    intro: (first) =>
      `${first}, this is the last reminder today. This has to get done before your shift ends.`,
  },
};

const FOLLOWUP_FOOTER =
  "This is required, not optional. A task that goes unfiled becomes visible to your center administrator.";

/**
 * The escalating "still not done" check-in — one at checkin_1_at (noon
 * by default), one at checkin_2_at (mid-afternoon), only to someone who
 * still has something outstanding at that hour. See
 * supabase/staff-task-followups.sql for why this has no opt-out: the
 * owner was explicit that this is an admin decision about how the
 * clinic runs, not a personal preference to switch off.
 *
 * Returns null rather than an empty notice when there is nothing left
 * to chase — a "good job, nothing due" email at 3pm is not urgency, it
 * is noise, and noise is exactly what teaches people to stop reading
 * these. See renderEmailHtml()'s own comment on the same principle.
 */
export async function followUpFor(
  sql: StaffSql,
  org: string,
  recipient: HuddleRecipient,
  tier: FollowUpTier
): Promise<{ subject: string; body: string; html: string } | null> {
  const { late, dueOnly } = await outstandingTasks(sql, org, recipient.jobRole);
  const count = late.length + dueOnly.length;
  if (count === 0) return null;

  const first = (recipient.legalName ?? "there").split(" ")[0];
  const copy = FOLLOWUP_COPY[tier];

  const lines = [
    copy.label,
    "",
    copy.intro(first),
    "",
    ...late.map((t) => `  LATE — ${labelFor(t.name, t.slot)}`),
    ...dueOnly.map((t) => `  DUE — ${labelFor(t.name, t.slot)}`),
    "",
    FOLLOWUP_FOOTER,
  ];

  const sections: EmailSection[] = [
    {
      heading: copy.label,
      tone: "critical",
      items: [
        ...late.map((t) => ({ primary: labelFor(t.name, t.slot), secondary: "Late — not filed" })),
        ...dueOnly.map((t) => ({ primary: labelFor(t.name, t.slot), secondary: "Due today — not filed" })),
      ],
    },
  ];

  const html = renderEmailHtml({
    title: `${copy.label} — ${count} still not done`,
    intro: copy.intro(first),
    sections,
    footerLines: [FOLLOWUP_FOOTER, org],
  });

  return {
    subject: `${copy.label} · ${count} still not done · ${org}`,
    body: lines.join("\n"),
    html,
  };
}

import type { StaffSql } from "@/lib/staff/db";
import { renderEmailHtml, type EmailSection } from "@/lib/staff/email-html";
import { jobLabel } from "@/lib/staff/roles";
import { dayOfYear } from "@/lib/staff/history-facts";
import { listBulletins } from "@/lib/staff/bulletins";

// The morning huddle: one email at the start of the day, to the people
// actually scheduled to work it. See supabase/staff-morning-huddle.sql
// for the two columns behind this (huddle_at, wants_morning_huddle) and
// app/api/cron/alerts/route.ts for where it is sent from.
//
// PER PERSON, NOT PER ORG. The AM/PM digest (digestFor, above this file
// in lib/staff/alerts.ts) is one message about the whole clinic; this is
// "your day," which means the agenda has to be scoped to the one job the
// reader actually holds — the same scoping shiftState() already uses on
// the Today page, so what this says and what they see when they open the
// app cannot disagree.

// One uplifting line to open the day with. Same rotation rule as
// factOfTheDay() in lib/staff/history-facts.ts — the whole shift reads
// the same line on the same calendar day, and it changes once a day, not
// on every send. CURATED, NOT GENERATED: see that file's own note on why
// — a bar that applies here too, not just to historical facts.
const QUOTES: string[] = [
  "Well begun is half done. — attributed to Aristotle",
  "The days are long, but the decade is short.",
  "Quality is not an act, it is a habit. — attributed to Aristotle",
  "Slow is smooth, and smooth is fast.",
  "Small, steady steps clear more ground than one big leap.",
  "The best time to fix a small problem is before it is a big one.",
  "A calm start makes for a calm shift.",
  "Every check you file is one less thing anyone has to remember later.",
  "Good habits are worth being fanatical about. — attributed to John Irving",
  "Nothing is particularly hard if you divide it into small jobs. — attributed to Henry Ford",
  "The work is easier when it's shared, and heavier when it's carried alone.",
  "Progress is progress, no matter how small the step.",
  "What gets checked gets caught early.",
  "A clear morning plan is worth an hour of afternoon scrambling.",
  "Take care of the small things, and the big things take care of themselves.",
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

/** Everyone who gets today's huddle: active, opted in (default true —
 *  see the column's own comment), and scheduled to work today by their
 *  own workdays. The isodow check is identical to onDutyToday()'s in
 *  lib/staff/roster-today.ts; kept separate because that function
 *  returns a display roster grouped by role, and this one returns
 *  individual send targets — different enough shapes that sharing one
 *  function would mean one of the two callers unpacking data it doesn't
 *  want. */
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
       and u.wants_morning_huddle
       and u.job_role is not null
       and extract(isodow from (now() at time zone o.timezone))::smallint = any (u.workdays)
     order by u.legal_name
  `;
}

const labelFor = (name: string, slot: string) => (slot ? `${name} (${slot.toUpperCase()})` : name);

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
  const outstanding = await sql<{ name: string; slot: string }[]>`
    select name, slot from staff.todays_logs
     where org_slug = ${org}
       and staff.brief_matches(job_roles, ${recipient.jobRole}::staff.job_role)
       and response_id is null
     order by sort_order, slot
  `;
  const late = await sql<{ name: string; slot: string }[]>`
    select name, slot from staff.overdue_today
     where org_slug = ${org}
       and staff.brief_matches(job_roles, ${recipient.jobRole}::staff.job_role)
     order by slot, name
  `;
  const lateKeys = new Set(late.map((l) => `${l.name}:${l.slot}`));
  const dueOnly = outstanding.filter((o) => !lateKeys.has(`${o.name}:${o.slot}`));

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

  const sections: EmailSection[] = [
    {
      heading: agendaHeading,
      tone: late.length > 0 ? "critical" : dueOnly.length > 0 ? "warn" : "good",
      items:
        late.length + dueOnly.length === 0
          ? [{ primary: "Nothing due for you right now." }]
          : [
              ...late.map((t) => ({ primary: labelFor(t.name, t.slot), secondary: "Late — not filed" })),
              ...dueOnly.map((t) => ({ primary: labelFor(t.name, t.slot), secondary: "Due today" })),
            ],
    },
    {
      heading: "Notes from the center admin",
      tone: "muted",
      items: notes.map((n) => ({
        primary: n.body,
        secondary: n.author_name ?? n.author_email,
      })),
    },
  ];

  const html = renderEmailHtml({
    title: `Good morning, ${first}`,
    intro: quote,
    sections,
    footerLines: [`${org} · times in ${timezone}`],
  });

  return {
    subject: `Good morning, ${first} — ${org}`,
    body: lines.join("\n"),
    html,
  };
}

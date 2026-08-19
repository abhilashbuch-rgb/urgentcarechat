import { createHash, randomBytes } from "node:crypto";
import { ROOT_URL } from "@/lib/site";
import { isMailConfigured, send } from "@/lib/mail";
import { withOrg, type StaffSql } from "@/lib/staff/db";
import {
  gatherReport,
  totals,
  type Cadence,
  type ReportData,
} from "@/lib/staff/report";

// The scheduled side of log reports: who is due one, minting the link,
// and sending the email.
//
// SAME TOKEN DESIGN AS THE SURVEYOR LINK (lib/staff/surveyor.ts): 32
// random bytes base64url, only the SHA-256 stored. A database dump yields
// no working links, and there is no reversible secret anywhere in the
// row. Deliberately not shared code with surveyor.ts — these expire on
// different clocks and grant different things, and one "issueLink" doing
// both would eventually leak an inspector's scope into an owner's report
// or the reverse.

/** How long a report link stays live. Ninety days rather than the
 *  surveyor link's days: an owner may open a monthly report weeks late,
 *  and the failure mode of too-short is a dead link in an inbox with no
 *  way to ask for a new one. */
const LINK_DAYS = 90;

export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface DueSubscription {
  id: string;
  org_slug: string;
  email: string;
  label: string | null;
  cadence: Cadence;
  period_start: string;
  period_end: string;
}

/**
 * Every subscription whose send hour has arrived and whose period has not
 * already been sent.
 *
 * CROSS-ORG, so it runs OUTSIDE a single org's session — the sweep is a
 * platform job, like the alert sweep. It reads only subscription rows and
 * the period function; the report itself is then gathered inside each
 * org's own scoped session, so no report is ever built with another
 * clinic's context set.
 */
export async function dueSubscriptions(sql: StaffSql): Promise<DueSubscription[]> {
  return sql<DueSubscription[]>`
    select s.id, s.org_slug, s.email, s.label, s.cadence,
           p.period_start::text as period_start,
           p.period_end::text   as period_end
      from staff.report_subscriptions s
      cross join lateral staff.report_period_due(
        s.org_slug, s.cadence, s.send_hour, s.send_dow, s.send_dom
      ) as p
     where s.active
       -- The period-already-sent guard. Belt to the unique index's
       -- braces: the index makes a duplicate impossible, this stops the
       -- sweep spending a PDF render and a mail call discovering that.
       and (s.last_period_end is null or s.last_period_end < p.period_end)
     order by s.org_slug, s.cadence
  `;
}

function subjectFor(d: ReportData, t: ReturnType<typeof totals>): string {
  const label =
    d.cadence === "daily" ? "Daily" : d.cadence === "weekly" ? "Weekly" : "Monthly";
  // The exception count goes in the SUBJECT, because the subject line is
  // the only part guaranteed to be read. "All clear" in the subject is
  // what makes a clean week cost the reader nothing.
  const problems = t.outOfRange + t.missed;
  const tail =
    problems === 0
      ? "all clear"
      : `${problems} to review`;
  return `${label} log report — ${d.orgName} — ${tail}`;
}

function bodyFor(d: ReportData, t: ReturnType<typeof totals>, url: string): string {
  const period =
    d.periodStart === d.periodEnd
      ? d.periodStart
      : `${d.periodStart} to ${d.periodEnd}`;

  // THE NUMBERS ARE IN THE EMAIL, not only in the PDF. An owner whose
  // period was clean should never have to click anything to learn that —
  // a digest that requires a download to say "fine" is a digest that
  // stops being opened by week three.
  const lines = [
    `${d.orgName}`,
    `${period} · times in ${d.timezone}`,
    "",
    `Logs filed:                 ${t.filed}`,
    `Due and not filed:          ${t.missed}`,
    `Out of range:               ${t.outOfRange}`,
    `Filed away from the clinic: ${t.offSite}`,
    `Staff who filed:            ${t.people}`,
    "",
  ];

  if (t.outOfRange === 0 && t.missed === 0) {
    lines.push(
      "Nothing needs your attention in this period. The full record is",
      "below if you want it."
    );
  } else {
    lines.push(
      "The full report lists each one with the time, who filed it, and the",
      "corrective action they recorded."
    );
  }

  lines.push(
    "",
    `Full report (PDF):`,
    url,
    "",
    `This link works for ${LINK_DAYS} days and opens the report without a`,
    "login. Treat it like the document itself — it names staff. Anyone with",
    "the link can read it, and an administrator can revoke it.",
    "",
    "The PDF is generated when you open it, so an amended entry shows as",
    "amended rather than as whatever was true when this was sent."
  );

  return lines.join("\n");
}

export interface SendOutcome {
  subscription: string;
  org: string;
  cadence: Cadence;
  period: string;
  to: string;
  ok: boolean;
  error?: string;
}

/**
 * Build, record and send one due report.
 *
 * THE ROW IS WRITTEN BEFORE THE MAIL IS SENT, and last_period_end is
 * advanced either way. A provider outage must not turn into the same
 * report being retried every hour for a day — the run row records the
 * failure in send_error and the owner can be told once, which is the same
 * decision the alert sweep made after it was found burning its retry
 * budget without attempting anything.
 */
export async function sendReport(due: DueSubscription): Promise<SendOutcome> {
  const period =
    due.period_start === due.period_end
      ? due.period_start
      : `${due.period_start}..${due.period_end}`;
  const base: Omit<SendOutcome, "ok"> = {
    subscription: due.id,
    org: due.org_slug,
    cadence: due.cadence,
    period,
    to: due.email,
  };

  const token = mintToken();
  const url = `${ROOT_URL}/report/${token}`;

  try {
    // Scoped to the org whose report this is. Everything the PDF contains
    // is read under this context, so a subscription row pointing at the
    // wrong slug produces an empty report rather than another clinic's.
    const { data, runId } = await withOrg(
      due.org_slug,
      "org_admin",
      async (sql) => {
        const d = await gatherReport(
          sql,
          due.org_slug,
          due.cadence,
          due.period_start,
          due.period_end
        );

        const [run] = await sql<{ id: string }[]>`
          insert into staff.report_runs
            (org_slug, subscription_id, cadence, period_start, period_end,
             token_hash, expires_at, sent_to)
          values
            (${due.org_slug}, ${due.id}, ${due.cadence},
             ${due.period_start}::date, ${due.period_end}::date,
             ${hashToken(token)},
             now() + ${`${LINK_DAYS} days`}::interval, ${due.email})
          -- The unique index on (subscription_id, period_end) makes a
          -- second attempt at the same window a no-op rather than a
          -- second email.
          on conflict do nothing
          returning id
        `;

        // Advanced whether or not the mail lands, for the reason in the
        // docstring above.
        await sql`
          update staff.report_subscriptions
             set last_period_end = ${due.period_end}::date,
                 last_sent_at = now()
           where id = ${due.id}
        `;

        return { data: d, runId: run?.id ?? null };
      }
    );

    // Already sent — the conflict fired. Not an error, and not worth a
    // second email.
    if (!runId) return { ...base, ok: true };

    if (!isMailConfigured()) {
      await withOrg(due.org_slug, "org_admin", (sql) => sql`
        update staff.report_runs
           set send_error = 'no mail provider configured'
         where id = ${runId}
      `);
      return { ...base, ok: false, error: "no_mail_provider" };
    }

    const t = totals(data);
    await send({
      to: due.email,
      subject: subjectFor(data, t),
      text: bodyFor(data, t, url),
    });

    await withOrg(due.org_slug, "org_admin", (sql) => sql`
      update staff.report_runs set sent_at = now() where id = ${runId}
    `);

    return { ...base, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    // Best effort: if the failure was the mail call rather than the
    // database, record why against the run so it is visible later.
    await withOrg(due.org_slug, "org_admin", (sql) => sql`
      update staff.report_runs
         set send_error = ${message.slice(0, 500)}
       where subscription_id = ${due.id}
         and period_end = ${due.period_end}::date
         and sent_at is null
    `).catch(() => undefined);
    return { ...base, ok: false, error: message };
  }
}

export interface RedeemedReport {
  runId: string;
  org: string;
  cadence: Cadence;
  periodStart: string;
  periodEnd: string;
}

/**
 * Exchange a link token for the report it points at, counting the view.
 *
 * Expired, revoked, mistyped and never-existed all return null, for the
 * same reason the surveyor page renders one screen for all four: a
 * distinguishing response turns this into an oracle confirming which
 * tokens are real.
 */
export async function redeemReport(token: string): Promise<RedeemedReport | null> {
  // Cheap shape check before touching the database. 32 bytes base64url is
  // 43 characters; anything else cannot be one of ours.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const hash = hashToken(token);

  // No org context yet — the token is what determines it. Deliberately
  // the only cross-org read this feature does, and it happens once per
  // open.
  const rows = await withOrg("", "platform_super_admin", (sql) => sql<
    {
      id: string;
      org_slug: string;
      cadence: Cadence;
      period_start: string;
      period_end: string;
    }[]
  >`
    update staff.report_runs
       set viewed_count = viewed_count + 1,
           last_viewed_at = now()
     where token_hash = ${hash}
       and revoked_at is null
       and expires_at > now()
    returning id, org_slug, cadence,
              period_start::text as period_start,
              period_end::text   as period_end
  `);

  const r = rows[0];
  if (!r) return null;
  return {
    runId: r.id,
    org: r.org_slug,
    cadence: r.cadence,
    periodStart: r.period_start,
    periodEnd: r.period_end,
  };
}

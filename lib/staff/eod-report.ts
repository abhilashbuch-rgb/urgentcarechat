import { ROOT_URL } from "@/lib/site";
import { isMailConfigured, send } from "@/lib/mail";
import { withOrg, type StaffSql } from "@/lib/staff/db";
import { mintToken, hashToken } from "@/lib/staff/report-schedule";
import {
  gatherReport,
  gatherEodExtras,
  renderReport,
  totals,
  type ReportData,
} from "@/lib/staff/report";

// The end-of-day report: automatic, admin-only, attached.
//
// DIFFERENT FROM staff.report_subscriptions ON PURPOSE. That system is
// for an arbitrary address that may hold no staff account at all — an
// accountant, a franchise manager — and stays exactly as it was, a
// revocable link with nothing attached (see the header of
// supabase/staff-reports.sql for why: these name people, and a stored
// attachment cannot be recalled). This one is for the people who
// actually administer the clinic day to day: every active org_admin and
// platform_super_admin gets today's report automatically, no
// subscription required.
//
// BOTH AN ATTACHMENT AND A LINK. The attachment is what was actually
// asked for — something that lands in the inbox and archives itself,
// no dependency on a link staying valid months later. The link stays
// alongside it precisely because the reasoning in staff-reports.sql is
// still correct on its own terms: a link can be revoked and its opens
// counted, and an attachment never can be. An administrator who needs
// to walk back who was sent what still has that lever.

const LINK_DAYS = 90;

export interface EodRecipient {
  id: string;
  email: string;
}

/** Every active admin-or-above account in the org. Not a preference —
 *  there is nothing to opt into or out of here, the same way there is
 *  nothing to opt out of for an excursion. Administering the clinic
 *  carries seeing this by default. */
export async function eodRecipients(
  sql: StaffSql,
  org: string
): Promise<EodRecipient[]> {
  return sql<EodRecipient[]>`
    select id, email from staff.users
     where org_slug = ${org} and active
       and role in ('org_admin', 'platform_super_admin')
     order by email
  `;
}

/** Has this address already been sent the EOD report for this date?
 *  Guards the same failure mode staff.report_subscriptions' unique
 *  index guards for the link-only flow: an hourly cron that fires twice
 *  in the due hour must not attach and send the same PDF twice. */
async function alreadySent(
  sql: StaffSql,
  org: string,
  date: string,
  email: string
): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    select id from staff.report_runs
     where org_slug = ${org} and subscription_id is null
       and cadence = 'daily' and period_start = ${date}::date
       and period_end = ${date}::date and sent_to = ${email}
     limit 1
  `;
  return Boolean(row);
}

export interface EodSendOutcome {
  org: string;
  date: string;
  to: string;
  ok: boolean;
  error?: string;
}

/** Send one org's EOD report to every admin-or-above account, for the
 *  given date (the clinic's own "yesterday" by the time this runs at
 *  digest_pm_at — see app/api/cron/reports/route.ts for how the date is
 *  chosen). One PDF render per org, reused across recipients; one token
 *  and one report_runs row per recipient, so each admin's link is
 *  independently revocable. */
export async function sendEodReports(
  org: string,
  date: string
): Promise<EodSendOutcome[]> {
  if (!isMailConfigured()) {
    return [{ org, date, to: "", ok: false, error: "no_mail_provider" }];
  }

  return withOrg(org, "org_admin", async (sql) => {
    const recipients = await eodRecipients(sql, org);
    if (recipients.length === 0) return [];

    const base = await gatherReport(sql, org, "daily", date, date);
    const extras = await gatherEodExtras(sql, org, date);
    const data: ReportData = { ...base, ...extras };
    const t = totals(data);
    const pdf = await renderReport(data);
    const subject = subjectFor(data, t);

    const outcomes: EodSendOutcome[] = [];
    for (const r of recipients) {
      if (await alreadySent(sql, org, date, r.email)) {
        outcomes.push({ org, date, to: r.email, ok: true });
        continue;
      }

      const token = mintToken();
      try {
        const [run] = await sql<{ id: string }[]>`
          insert into staff.report_runs
            (org_slug, subscription_id, cadence, period_start, period_end,
             token_hash, expires_at, sent_to)
          values
            (${org}, null, 'daily', ${date}::date, ${date}::date,
             ${hashToken(token)}, now() + ${`${LINK_DAYS} days`}::interval,
             ${r.email})
          returning id
        `;

        await send({
          to: r.email,
          subject,
          text: bodyFor(data, t, `${ROOT_URL}/report/${token}`),
          attachments: [
            {
              filename: `${org}-eod-${date}.pdf`,
              content: pdf,
              contentType: "application/pdf",
            },
          ],
        });

        await sql`
          update staff.report_runs set sent_at = now() where id = ${run.id}
        `;
        outcomes.push({ org, date, to: r.email, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        outcomes.push({ org, date, to: r.email, ok: false, error: message });
      }
    }
    return outcomes;
  });
}

function subjectFor(d: ReportData, t: ReturnType<typeof totals>): string {
  const problems = t.outOfRange + t.missed + (d.missingPhotos?.length ?? 0);
  const tail = problems === 0 ? "all clear" : `${problems} to review`;
  return `${d.orgName}: end-of-day report — ${d.periodStart} — ${tail}`;
}

function bodyFor(
  d: ReportData,
  t: ReturnType<typeof totals>,
  url: string
): string {
  const lines = [
    `${d.orgName} — end of day, ${d.periodStart}`,
    "",
    `Logs filed:                 ${t.filed}`,
    `Due and not filed:          ${t.missed}`,
    `Out of range:                ${t.outOfRange}`,
    `Filed away from the clinic: ${t.offSite}`,
    `Missing a required photo:   ${d.missingPhotos?.length ?? 0}`,
    `Staff who signed in today:  ${d.signins?.length ?? 0}`,
    "",
    "The full report — every log, every sign-in, every photo taken — is",
    "attached as a PDF. It also stays viewable, and revocable, at:",
    url,
  ];
  return lines.join("\n");
}

import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured, withOrg } from "@/lib/staff/db";
import {
  dueSubscriptions,
  sendReport,
  type SendOutcome,
} from "@/lib/staff/report-schedule";
import { sendEodReports, type EodSendOutcome } from "@/lib/staff/eod-report";

// GET /api/cron/reports — send whatever scheduled log reports are due.
//
// HOURLY, like the alert sweep, and the hour is the resolution. A
// subscription set to send at 07:00 goes out on the 07:00 sweep; there is
// no minute-level scheduling because nobody reading a weekly digest cares
// whether it arrived at 07:00 or 07:40, and per-minute cron would mean
// sixty times the invocations for no benefit anybody can perceive.
//
// WHICH PERIOD IS DUE IS DECIDED IN SQL, by staff.report_period_due,
// using the ORG's timezone. Doing it here would mean the clinic's day
// boundary depended on where the serverless function happened to run.
//
// IDEMPOTENT AT TWO LEVELS. The sweep skips subscriptions whose
// last_period_end already covers the due window, and the unique index on
// (subscription_id, period_end) makes a duplicate physically impossible
// if two sweeps overlap. A cron that fires twice sends one email.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Rendering is deferred to when the link is opened, so this route only
// gathers counts and sends mail. Still generous: a franchise with forty
// clinics on a daily cadence is forty sequential sends.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  // Cross-org read, so platform context. Everything after this is scoped
  // to one org at a time inside sendReport() / sendEodReports().
  const due = await withOrg("", "platform_super_admin", (sql) =>
    dueSubscriptions(sql)
  );

  const results: SendOutcome[] = [];
  for (const d of due) {
    // Sequential rather than Promise.all. Mail providers rate-limit, and
    // a burst of forty sends that trips a limit fails the whole sweep
    // rather than one report.
    results.push(await sendReport(d));
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  // The EOD report, automatic per org, no subscription involved. Fires
  // at the clinic's own digest_pm_at — "end of day" already had a
  // clinic-local time attached to it, no new schedule concept needed.
  // TODAY's local date, not yesterday's: digest_pm_at lands in the
  // evening of the day it is reporting on, unlike the 7am subscription
  // sweep above, which is why staff.report_period_due's own "daily"
  // math (built for that 7am case) is not reused here.
  const eodDue = await withOrg("", "platform_super_admin", (sql) =>
    sql<{ slug: string; local_date: string }[]>`
      select slug, (now() at time zone timezone)::date::text as local_date
        from staff.orgs
       where active
         and date_trunc('hour', now() at time zone timezone)
             = date_trunc('hour', (now() at time zone timezone)::date + digest_pm_at)
    `
  );

  const eodResults: EodSendOutcome[] = [];
  for (const { slug, local_date } of eodDue) {
    try {
      eodResults.push(...(await sendEodReports(slug, local_date)));
    } catch (err) {
      console.error(
        `[cron-reports] EOD for ${slug} failed:`,
        err instanceof Error ? err.message : "Unknown"
      );
      eodResults.push({
        org: slug,
        date: local_date,
        to: "",
        ok: false,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  const eodSent = eodResults.filter((r) => r.ok).length;
  const eodFailed = eodResults.filter((r) => !r.ok);

  // Reports what was ACTUALLY sent, not what was attempted — the lie the
  // alert sweep used to tell before it was fixed.
  return NextResponse.json({
    ok: true,
    due: due.length,
    sent,
    failed: failed.length,
    failures: failed.map((f) => ({ org: f.org, to: f.to, error: f.error })),
    eod: {
      orgsDue: eodDue.length,
      sent: eodSent,
      failed: eodFailed.length,
      failures: eodFailed.map((f) => ({ org: f.org, to: f.to, error: f.error })),
    },
  });
}

function authorised(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

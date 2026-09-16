import { NextRequest, NextResponse } from "next/server";
import { withOrg, isDatabaseConfigured } from "@/lib/staff/db";
import { sendDueTodayReminders } from "@/lib/staff/obligation-reminder";

// GET /api/cron/obligations — one email per obligation, to whoever it's
// assigned to, on the day it's due. See lib/staff/obligation-reminder.ts
// for why this is its own small pipeline rather than folded into the
// huddle/digest cron.
//
// FIRES AT THE SAME LOCAL HOUR AS THE MORNING HUDDLE, deliberately, not
// a new per-org setting: this is one more "start of day" message, and a
// clinic that already chose when its day starts by setting huddle_at
// shouldn't have to make that same decision twice. Runs hourly, same as
// every other cron here, and only acts in the one hour a day that
// matches — see app/api/cron/alerts/route.ts's identical huddleDue
// check for the same reasoning.
//
// AUTHENTICATION. Same shared-secret-or-Vercel-header check as every
// other cron route in this module.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "no_database" }, { status: 503 });
  }

  const orgs = await withOrg("", "platform_super_admin", (sql) =>
    sql<{ slug: string; due: boolean }[]>`
      select slug,
             date_trunc('hour', now() at time zone timezone)
               = date_trunc('hour', (now() at time zone timezone)::date + huddle_at) as due
        from staff.orgs where active and not is_library
    `
  );

  const outcome: { org: string; sent: number; failed: number }[] = [];
  for (const o of orgs) {
    if (!o.due) continue;
    const results = await sendDueTodayReminders(o.slug);
    if (results.length > 0) {
      outcome.push({
        org: o.slug,
        sent: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      });
    }
  }

  return NextResponse.json({ ok: true, outcome });
}

function authorised(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

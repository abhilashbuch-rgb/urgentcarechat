import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { saveBillingStats, sendBillingStats, todaysBillingStats } from "@/lib/staff/billing-stats";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/billing-stats — tonight's patient count.
//
// Any signed-in account can file this, same as filing a log — the
// person who actually knows tonight's count is often plain "staff", and
// nothing here is worth gating tighter than that. Only WHO IT GETS
// EMAILED TO is owner-only, and that's set on a completely different
// route (app/api/staff/billing-contact/route.ts) that this one never
// touches — see supabase/staff-billing-stats.sql for why the two are
// kept apart.
//
// SENT RIGHT HERE, NOT QUEUED. This is a person waiting on the result of
// the button they just pressed, not a background sweep — same reasoning
// as app/api/staff/accreditation/email/route.ts. A resend on every
// resubmit is deliberate too: if the front desk catches a typo and
// corrects it, the biller should get the corrected number, not the
// first one forever.

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  const form = await req.formData();
  const countRaw = String(form.get("patient_count") ?? "").trim();
  const notesRaw = String(form.get("notes") ?? "").trim().slice(0, 500);

  const count = Number(countRaw);
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0 || count > 2000) {
    return redirectAfterPost("/staff/billing-stats?e=count");
  }

  try {
    const outcome = await withSession(session, async (sql) => {
      await saveBillingStats(sql, org, session.uid, count, notesRaw || null);
      const entry = await todaysBillingStats(sql, org);
      if (!entry) return { sent: "skipped" as const };

      const [orgRow] = await sql<{ name: string }[]>`
        select name from staff.orgs where slug = ${org}
      `;
      const result = await sendBillingStats(sql, org, orgRow?.name ?? org, entry);
      if (!result.ok) return { sent: "failed" as const };
      return { sent: result.skipped ? ("skipped" as const) : ("ok" as const) };
    });

    return redirectAfterPost(`/staff/billing-stats?saved=1&sent=${outcome.sent}`);
  } catch (err) {
    console.error(
      "[staff-billing-stats] save failed for org",
      org,
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/billing-stats?e=save");
  }
}

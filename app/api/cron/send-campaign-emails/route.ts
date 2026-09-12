import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/staff/db";
import { sendCampaignBatch } from "@/lib/staff/campaigns";

// GET /api/cron/send-campaign-emails — hourly, like every other sweep
// in this app (see vercel.json).
//
// FIVE AT A TIME, NOT FIFTY. A cold-outreach domain with no sending
// history reads a sudden burst of dozens of first-contact emails as
// exactly the pattern spam filtering is built to catch — the limit
// below is a deliberate warm-up pace, not a performance ceiling. Raise
// it only once the domain has actual sending history to point to.
const BATCH_SIZE = 5;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const outcomes = await sendCampaignBatch(BATCH_SIZE);
  const sent = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.filter((o) => !o.ok);

  return NextResponse.json({
    ok: true,
    attempted: outcomes.length,
    sent,
    failed: failed.length,
    failures: failed.map((f) => ({ email: f.email, step: f.step, error: f.error })),
  });
}

function authorised(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

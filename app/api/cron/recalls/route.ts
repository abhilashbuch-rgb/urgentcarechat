import { NextRequest, NextResponse } from "next/server";
import { withOrg, isDatabaseConfigured } from "@/lib/staff/db";
import { fetchOngoingRecalls, matchRecallsForOrg } from "@/lib/staff/recalls";

// GET /api/cron/recalls — once a day: fetch openFDA's current Ongoing
// drug and device recalls, and match them against every clinic's own
// stocked inventory. See lib/staff/recalls.ts for the matching logic.
//
// ONE FETCH, EVERY ORG. The recall list is the same for every clinic —
// fetched once here, then checked against each org's own item names,
// rather than one openFDA call per org for data that doesn't vary by
// org at all.
//
// DAILY, NOT HOURLY. Unlike every other cron in this module, recall
// data does not change by the hour, and openFDA is a shared public
// resource this product should not hammer sixty times more than it
// needs to. See vercel.json for the schedule.
//
// AUTHENTICATION. Same shared-secret-or-Vercel-header check as every
// other cron route here.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "no_database" }, { status: 503 });
  }

  const { recalls, sourcesOk } = await fetchOngoingRecalls();
  if (sourcesOk.length === 0) {
    // Both sources failed — matching against nothing would clear every
    // org's real, still-valid alerts. Stop before touching the
    // database at all.
    return NextResponse.json({ ok: false, error: "no_source_reachable" }, { status: 502 });
  }

  const orgs = await withOrg("", "platform_super_admin", (sql) =>
    sql<{ slug: string }[]>`select slug from staff.orgs where active and not is_library`
  );

  const outcome: { org: string; matched: number; cleared: number }[] = [];
  for (const { slug } of orgs) {
    try {
      const result = await withOrg(slug, "platform_super_admin", (sql) =>
        matchRecallsForOrg(sql, slug, recalls, sourcesOk)
      );
      outcome.push({ org: slug, ...result });
    } catch (err) {
      // One clinic's bad row must not stop every other clinic's
      // matching on the same run.
      console.error(
        `[cron-recalls] ${slug} failed:`,
        err instanceof Error ? err.message : "Unknown"
      );
    }
  }

  return NextResponse.json({ ok: true, fetched: recalls.length, sourcesOk, orgs: outcome });
}

function authorised(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

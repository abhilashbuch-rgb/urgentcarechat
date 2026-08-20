import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/staff/db";
import { redeemReport } from "@/lib/staff/report-schedule";
import { gatherReport, renderReport } from "@/lib/staff/report";

// GET /report/<token> — the scheduled log report, as a PDF.
//
// NO SESSION. The token IS the credential, exactly as with the surveyor
// link, because the recipient may be an owner or an accountant who has no
// staff account and should not be given one to read a summary.
//
// A ROUTE, NOT A PAGE. It returns the PDF itself rather than a screen
// with a download button on it: the email already said what the numbers
// were, so the only reason anybody follows this link is to have the
// document. An interstitial page would be one more tap for nothing.
//
// RENDERED HERE, NOT STORED. See supabase/staff-reports.sql. The period
// comes off the run row, so a report opened in November still covers the
// week it was sent for.
//
// THE TOKEN MUST NOT TRAVEL: Referrer-Policy and X-Robots-Tag are set in
// proxy.ts for this path, the same way they are for /surveyor/.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const ctx = await redeemReport(token);
  // Expired, revoked, mistyped and never-existed are one answer. A
  // distinguishing response would confirm which tokens are real.
  if (!ctx) {
    return new NextResponse(
      "This report link has expired or been revoked.\n\n" +
        "Report links are time-limited by design. Ask your center " +
        "administrator to send a new one.",
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const data = await withOrg(ctx.org, "org_admin", (sql) =>
    gatherReport(sql, ctx.org, ctx.cadence, ctx.periodStart, ctx.periodEnd)
  );

  const pdf = await renderReport(data);
  const name = `${ctx.org}-${ctx.cadence}-${ctx.periodEnd}.pdf`;

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      // inline: a phone opens it in the viewer rather than dropping a
      // file into Downloads that nobody finds again.
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

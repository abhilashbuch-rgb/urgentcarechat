import { NextRequest, NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/staff/campaigns";
import { PRODUCT_NAME } from "@/lib/site";

// GET /api/unsubscribe?token=... — a click from a campaign email.
//
// NO SESSION. The token IS the credential, exactly as with the
// surveyor and scheduled-report links (see app/report/[token]/
// route.ts) — the person clicking has no staff account and should
// never be asked to create one just to opt out of mail.
//
// ONE ANSWER REGARDLESS. A missing, mistyped, or already-used token
// gets the same calm confirmation as a real one — a distinguishing
// response would let a prober test which tokens are live, and there
// is no legitimate reason a recipient needs to know which case they
// hit. See unsubscribeByToken() in lib/staff/campaigns.ts.
//
// The token travels in the URL, so this path gets the same
// no-referrer / no-index / no-cache treatment as /report/ and
// /surveyor/ — see proxy.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (token) {
    await unsubscribeByToken(token);
  }

  return new NextResponse(page(), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function page(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribed — ${PRODUCT_NAME}</title>
<style>
  body {
    margin: 0;
    background: #f4f6f9;
    color: #0a2540;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    max-width: 420px;
    width: 100%;
    background: #fff;
    border: 1px solid #d7e3f0;
    border-radius: 12px;
    padding: 32px;
    text-align: center;
  }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; line-height: 1.5; color: #48678a; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>You're unsubscribed</h1>
    <p>You won't get any more emails in this sequence from ${PRODUCT_NAME}.</p>
  </div>
</body>
</html>`;
}

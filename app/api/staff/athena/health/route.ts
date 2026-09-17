import { NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { getAccessToken, AthenaNotConnectedError } from "@/lib/athena/auth";
import { athenaRequest, AthenaApiError, type AthenaEnvironment } from "@/lib/athena/client";

// GET /api/staff/athena/health — the diagnostic the original integration
// notes called for (item 10: "test active token validity and
// connectivity"), deliberately deferred until there was a real
// athenahealth app to test against. There is now.
//
// PROVES THE TOKEN WORKS, NOT JUST THAT ONE WAS ISSUED. getAccessToken()
// succeeding only means athenahealth accepted our client credentials —
// it does not mean the resulting token is actually authorized to read
// this practice's data. This route makes one real, cheap GET
// (/departments) with the token before calling anything "connected."
//
// NEVER RETURNS THE TOKEN. Every response is a bare status word plus
// timestamps a browser console or a log line is safe to hold.
//
// ORG_ADMIN+ ONLY, same gate as the rest of the athenahealth-adjacent
// admin surface (app/api/staff/settings/reminders/route.ts and others).

export const runtime = "nodejs";

interface ConnectionRow {
  practice_id: string;
  environment: AthenaEnvironment;
  last_synced_at: string | null;
}

export async function GET() {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "org_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const connection = await withSession(session, async (sql) => {
    const rows = await sql<ConnectionRow[]>`
      select practice_id, environment, last_synced_at::text as last_synced_at
        from staff.athena_connections
       where org_slug = ${org}
    `;
    return rows[0] ?? null;
  });

  if (!connection) {
    return NextResponse.json({ status: "not_connected", last_synced_at: null });
  }

  try {
    const token = await getAccessToken(org);
    const res = await athenaRequest(
      connection.environment,
      connection.practice_id,
      token,
      "/departments"
    );

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({
        status: "unauthorized",
        last_synced_at: connection.last_synced_at,
      });
    }
    if (!res.ok) {
      return NextResponse.json({
        status: "error",
        detail: `athenahealth returned ${res.status} for /departments`,
        last_synced_at: connection.last_synced_at,
      });
    }

    return NextResponse.json({
      status: "connected",
      last_synced_at: connection.last_synced_at,
    });
  } catch (err) {
    if (err instanceof AthenaNotConnectedError) {
      return NextResponse.json({ status: "not_connected", last_synced_at: null });
    }
    if (err instanceof AthenaApiError) {
      return NextResponse.json({
        status: err.status === 401 || err.status === 403 ? "unauthorized" : "error",
        detail: `athenahealth ${err.status}`,
        last_synced_at: connection.last_synced_at,
      });
    }
    console.error(
      "[athena-health]",
      org,
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json({
      status: "error",
      detail: err instanceof Error ? err.message : "unknown error",
      last_synced_at: connection.last_synced_at,
    });
  }
}

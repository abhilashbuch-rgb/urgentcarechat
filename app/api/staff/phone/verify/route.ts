import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { confirmPhoneVerification } from "@/lib/staff/phone-verify";

// POST /api/staff/phone/verify — the six-digit half of the flow
// app/api/staff/phone/route.ts starts.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session } = auth.ctx;

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  try {
    const result = await withSession(session, (sql) =>
      confirmPhoneVerification(sql, session.uid, body.code ?? "")
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[staff-phone-verify] failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

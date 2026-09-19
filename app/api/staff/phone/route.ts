import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { startPhoneVerification } from "@/lib/staff/phone-verify";

// POST /api/staff/phone — save (or replace) your own phone number and
// text it a fresh six-digit code. Self-serve, same as
// app/api/staff/profile/route.ts: nobody needs a manager to type this
// in for them.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session } = auth.ctx;

  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const phone = (body.phone ?? "").trim();

  try {
    const result = await withSession(session, (sql) =>
      startPhoneVerification(sql, session.uid, phone)
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[staff-phone] failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

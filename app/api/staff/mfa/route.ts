import { NextRequest, NextResponse } from "next/server";
import { resolvePending } from "@/lib/staff/auth";
import { withOrg } from "@/lib/staff/db";
import { verifyCode, generateSecret } from "@/lib/staff/totp";
import { isLocalRequest } from "@/lib/staff/http";
import {
  signSession,
  STAFF_COOKIE,
  STAFF_COOKIE_MAX_AGE,
} from "@/lib/staff/session";

// POST /api/staff/mfa — enrol a second factor, or present one.
//
// Both actions live here because they end the same way: a code is
// verified and the pending session is upgraded to a full one. The only
// difference is where the secret comes from — a fresh one being confirmed,
// or the one already on file.
//
// Uses resolvePending() rather than resolve(), because by definition
// nobody reaching this endpoint has completed their second factor yet.
// That makes this the ONE route where a half-authenticated session is
// allowed to do anything, which is why it does exactly two things.

export const runtime = "nodejs";

interface Row {
  totp_secret: string | null;
  totp_confirmed_at: string | null;
  totp_last_step: string | null;
  session_epoch: number;
}

export async function POST(req: NextRequest) {
  const pending = await resolvePending();
  if (!pending.ok) {
    return NextResponse.json({ error: pending.reason }, { status: 401 });
  }
  const { session, org } = pending.ctx;

  let body: { action?: string; code?: string; secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  try {
    const result = await withOrg(org, session.role, async (sql) => {
      const rows = await sql<Row[]>`
        select totp_secret, totp_confirmed_at::text as totp_confirmed_at,
               totp_last_step::text as totp_last_step, session_epoch
          from staff.users where id = ${session.uid}
      `;
      if (rows.length === 0) return { error: "no_user" as const, status: 401 };
      const row = rows[0];

      if (body.action === "start") {
        // Re-enrolling replaces the pending secret but must NOT touch a
        // confirmed one — otherwise anyone holding a pending session could
        // wipe an existing second factor and enrol their own.
        if (row.totp_confirmed_at) {
          return { error: "already_enrolled" as const, status: 409 };
        }
        const secret = generateSecret();
        await sql`update staff.users set totp_secret = ${secret} where id = ${session.uid}`;
        return { secret };
      }

      // Verify — the path for both "confirm my new secret" and "let me in".
      if (!row.totp_secret) return { error: "not_enrolled" as const, status: 400 };

      const check = await verifyCode(
        row.totp_secret,
        body.code ?? "",
        row.totp_last_step === null ? null : Number(row.totp_last_step)
      );
      if (!check.ok) {
        await sql`
          insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id)
          values (${org}, ${session.uid}, 'mfa_failed', 'user', ${session.uid})
        `;
        return { error: "bad_code" as const, status: 400 };
      }

      // Recording the accepted step is what stops the same code being
      // presented twice inside its 30-second window.
      await sql`
        update staff.users
           set totp_last_step    = ${check.step},
               totp_confirmed_at = coalesce(totp_confirmed_at, now())
         where id = ${session.uid}
      `;
      await sql`
        insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id)
        values (${org}, ${session.uid},
                ${row.totp_confirmed_at ? "mfa_passed" : "mfa_enrolled"},
                'user', ${session.uid})
      `;
      return { verified: true, epoch: row.session_epoch };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    if ("secret" in result) {
      return NextResponse.json({ ok: true, secret: result.secret });
    }

    // Upgrade the pending session in place. Same identity, same expiry
    // clock, second factor now satisfied.
    const token = await signSession({
      uid: session.uid,
      org: session.org,
      role: session.role,
      email: session.email,
      name: session.name,
      ep: result.epoch,
      mfa: "ok",
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(STAFF_COOKIE, token, {
      httpOnly: true,
      secure: !isLocalRequest(req),
      sameSite: "lax",
      path: "/",
      maxAge: STAFF_COOKIE_MAX_AGE,
    });
    return res;
  } catch (err) {
    console.error(
      "[staff-mfa] failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

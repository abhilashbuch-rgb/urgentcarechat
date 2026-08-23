import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withOrg } from "@/lib/staff/db";
import { signSession, STAFF_COOKIE, STAFF_COOKIE_MAX_AGE } from "@/lib/staff/session";

// POST /api/staff/switch-org — move this session to a different clinic
// the signed-in person can reach.
//
// RLS scopes a request to exactly one org, set from the session cookie —
// there is no query that spans two. "Switching" is therefore not a
// server-side context change, it is re-minting the cookie with a
// different org claim, which the NEXT request's live check then has to
// accept. staff.session_check_for() is what accepts it: it returns a row
// for the person's home clinic OR any clinic granted via
// staff.user_orgs, and nothing at all otherwise — so a slug this session
// has no standing in fails closed here, the same way a forged cookie
// would fail in lib/staff/auth.ts.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org: currentOrg } = auth.ctx;

  let body: { slug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const target = (body.slug ?? "").trim();
  if (!target) {
    return NextResponse.json({ error: "missing_slug" }, { status: 400 });
  }
  if (target === currentOrg) {
    return NextResponse.json({ ok: true, org: currentOrg });
  }

  const found = await withOrg("", "platform_super_admin", async (sql) => {
    const rows = await sql<{ role: string }[]>`
      select role from staff.session_check_for(${session.uid}, ${target})
    `;
    return rows[0] ?? null;
  });
  if (!found) {
    return NextResponse.json({ error: "not_your_clinic" }, { status: 403 });
  }

  await withOrg(target, found.role, async (sql) => {
    await sql`
      insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
      values (${target}, ${session.uid}, 'org_switch', 'user', ${session.uid},
              ${sql.json({ from: currentOrg })})
    `;
  });

  const token = await signSession({
    uid: session.uid,
    org: target,
    role: found.role as typeof session.role,
    email: session.email,
    name: session.name,
    ep: session.ep,
    mfa: session.mfa,
  });

  const res = NextResponse.json({ ok: true, org: target });
  res.cookies.set(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: STAFF_COOKIE_MAX_AGE,
  });
  return res;
}

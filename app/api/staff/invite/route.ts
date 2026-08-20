import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/staff/db";
import { redeem } from "@/lib/staff/invites";

// POST /api/staff/invite — accept an invitation.
//
// UNAUTHENTICATED, AND IT GRANTS NOTHING. This marks the invitation
// accepted and sends the person to sign-in with their address filled in.
// It does not create a session, and it does not create a user row.
//
// That is the important part. If accepting a link logged somebody in,
// then anybody who obtained the link — a forwarded email, a shared
// screen, a mailbox left open on the front desk — would be inside the
// clinic's records. Instead they still have to prove they hold the
// address, through Google or the emailed six-digit code, and the invite
// row is re-read at that point. Two independent things must go right.
//
// So the invitation answers "may this address be here", and sign-in
// answers "are you this address". Neither is sufficient alone, which is
// what makes a leaked link survivable.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "unknown" }, { status: 400 });

  // Platform context: there is no session yet, and the org is whatever
  // the invitation says it is. The token is the only input, and it is
  // matched by hash against rows that are neither revoked nor already
  // accepted.
  const result = await withOrg("", "platform_super_admin", (sql) =>
    redeem(sql, token)
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  // The address is carried to the sign-in screen so the new hire does not
  // have to retype it — and so they cannot accidentally sign in with a
  // personal address that was never invited and be turned away without
  // understanding why.
  const next = `/staff/signin?invited=${encodeURIComponent(result.email)}`;
  return NextResponse.json({ ok: true, next });
}

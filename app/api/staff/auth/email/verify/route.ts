import { NextRequest, NextResponse } from "next/server";
import { withOrg, isDatabaseConfigured } from "@/lib/staff/db";
import { verifyChallenge, resolveInvite } from "@/lib/staff/email-auth";
import { onboardingState, stepFor } from "@/lib/staff/onboarding";
import {
  signSession,
  STAFF_COOKIE,
  STAFF_COOKIE_MAX_AGE,
  type StaffRole,
} from "@/lib/staff/session";

// POST /api/staff/auth/email/verify — redeem a code or a link token.
//
// THIS IS THE SECOND HALF OF A DOOR, NOT A SECOND DOOR. Holding the
// address proves who you are; the invite decides whether you may come
// in. Both are checked here, in that order, and the invite is re-read at
// this moment rather than trusted from the request — an invite revoked
// in the ten minutes since the code was sent must not still work.
//
// MFA IS UNCHANGED. If the org requires a second factor for this role,
// the session is minted "pending" exactly as the Google callback does,
// and every route outside the MFA screens treats pending as signed out.
// Arriving by email does not skip the TOTP step.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "not_open_yet" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : undefined;
  const email = typeof body?.email === "string" ? body.email : undefined;
  const code = typeof body?.code === "string" ? body.code : undefined;

  const result = await verifyChallenge({ token, email, code });
  if (!result.ok) {
    // "invalid" and "expired" render the same sentence on screen —
    // telling an attacker a code was once real is the one bit worth
    // having when guessing. "too_many" is distinguished only because a
    // person who has genuinely mistyped five times needs to be told to
    // request a fresh code rather than keep trying.
    const status = result.reason === "too_many" ? 429 : 401;
    return NextResponse.json({ error: result.reason }, { status });
  }

  // Re-read at redemption, not carried from the request.
  const invite = await resolveInvite(result.email);
  if (!invite) {
    return NextResponse.json({ error: "no_invite" }, { status: 403 });
  }

  const outcome = await withOrg(invite.org, "platform_super_admin", async (sql) => {
    const existing = await sql<
      {
        id: string;
        role: StaffRole;
        active: boolean;
        name: string | null;
        session_epoch: number;
        mfa_enrolled: boolean;
      }[]
    >`
      select id, role, active, name, session_epoch,
             (totp_confirmed_at is not null) as mfa_enrolled
        from staff.users
       where lower(email) = ${result.email} and org_slug = ${invite.org}
    `;

    let user = existing[0];

    if (user && !user.active) return { denied: "deactivated" as const };

    if (!user) {
      // First sign-in. The job and the legal name come off the invite,
      // same as the Google path — so a new hire lands on a board that
      // already has their work on it rather than an empty one.
      const created = await sql<typeof existing>`
        insert into staff.users
          (email, name, org_slug, role, job_role, legal_name)
        values
          (${result.email}, ${invite.legalName}, ${invite.org},
           ${invite.role}::staff.user_role,
           ${invite.jobRole}::staff.job_role, ${invite.legalName})
        returning id, role, active, name, session_epoch,
                  (totp_confirmed_at is not null) as mfa_enrolled
      `;
      user = created[0];
    } else {
      await sql`update staff.users set last_seen_at = now() where id = ${user.id}`;
    }

    const [org] = await sql<{ mfa_required_roles: StaffRole[] }[]>`
      select mfa_required_roles from staff.orgs where slug = ${invite.org}
    `;

    await sql`
      insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
      values (${invite.org}, ${user.id}, 'signin', 'user', ${user.id},
              ${sql.json({ method: "email" })})
    `;

    // Someone still filling out onboarding has no authenticator app yet —
    // asking for a TOTP code before the wizard even starts throws them for
    // a loop. MFA for this role is still mandatory; it's just deferred
    // until the moment onboarding actually finishes (see the "orientation"
    // action in /api/staff/onboarding).
    const state = await onboardingState(sql, user.id);
    const needsOnboarding = !state || stepFor(state) !== "done";

    return {
      user,
      mfaRequired: (org?.mfa_required_roles ?? []).includes(user.role),
      needsOnboarding,
    };
  });

  if ("denied" in outcome) {
    return NextResponse.json({ error: outcome.denied }, { status: 403 });
  }

  const { user, mfaRequired, needsOnboarding } = outcome;
  const mfaPending = mfaRequired && !needsOnboarding;

  const session = await signSession({
    uid: user.id,
    org: invite.org,
    role: user.role,
    email: result.email,
    name: user.name,
    ep: user.session_epoch,
    mfa: mfaPending ? "pending" : "ok",
  });

  const next = needsOnboarding
    ? "/staff/onboarding"
    : !mfaRequired
      ? "/staff"
      : user.mfa_enrolled
        ? "/staff/mfa"
        : "/staff/mfa/enroll";

  const res = NextResponse.json({ ok: true, next });
  res.cookies.set(STAFF_COOKIE, session, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: STAFF_COOKIE_MAX_AGE,
  });
  return res;
}

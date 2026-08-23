import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { STAFF_COOKIE, verifySession, type StaffSession } from "@/lib/staff/session";
import { withOrg } from "@/lib/staff/db";

// Session + org resolution for server components under /staff.
//
// WHERE THE ORG COMES FROM, AND WHY IT CHANGED.
//
// This used to read the org from the hostname — <org>.medicin.io —
// which had the nice property that a stale cookie could not choose which
// clinic you were looking at. It also cost one Google OAuth redirect URI
// and one hand-added Vercel domain per customer, which makes self-serve
// signup impossible. Staff now sign in at one address for everyone.
//
// The replacement is not weaker. The org comes from the user's own row,
// re-read from the database on EVERY request — so a cookie cannot choose
// an org because the cookie is not what is consulted. The cookie carries
// a claim; the database settles it. A cookie whose org disagrees with the
// row, or whose epoch is behind it, is refused.
//
// Tenant subdomains still exist, for white-label PATIENT portals where
// the branding is the point. They no longer serve /staff at all —
// proxy.ts redirects it to the root domain, so there is exactly one
// staff door.
//
// THE DATABASE READ IS NOT OPTIONAL. A signed cookie is a statement about
// the past: it says who this was when they signed in. Deactivation,
// revocation, and role changes all happen after that, so a session that is
// only cryptographically valid is not the same as a session that is still
// allowed. React's cache() dedupes the read within a request, so a layout
// and its page cost one query between them, not two.

export interface StaffContext {
  session: StaffSession;
  /** The org this request is for — the one on the user's database row,
   *  confirmed this request. Never taken from the cookie alone. */
  org: string;
}

/**
 * The tenant a hostname belongs to, if any. Still used by the patient
 * portal; no longer used to decide a staff session's org.
 */
export async function hostOrg(): Promise<string | null> {
  const h = await headers();
  return h.get("x-tenant-slug");
}

export async function currentSession(): Promise<StaffSession | null> {
  const jar = await cookies();
  try {
    return await verifySession(jar.get(STAFF_COOKIE)?.value);
  } catch {
    // verifySession throws only when STAFF_SESSION_SECRET is missing.
    // Treating a misconfigured server as "signed out" is the safe
    // direction; the sign-in route surfaces the real error.
    return null;
  }
}

export interface LiveUser {
  role: string;
  active: boolean;
  session_epoch: number;
  mfa_enrolled: boolean;
}

/**
 * The current truth about a user IN THIS ORG. Cached per request, not
 * across them.
 *
 * ORG-AWARE, NOT JUST USER-AWARE. staff.session_checks (what this used to
 * query) reads straight off staff.users, which carries exactly one home
 * clinic per person — so a cookie claiming a second clinic a multi-site
 * owner has been granted access to would find no matching row and get
 * treated as forged. staff.session_check_for() resolves against BOTH the
 * home clinic and anything in staff.user_orgs, and returns nothing at all
 * for an org the person cannot reach — the same fail-closed shape,
 * widened to the actual set of clinics a session's org claim may name.
 */
const liveUser = cache(async function liveUser(
  org: string,
  role: string,
  uid: string
): Promise<LiveUser | null> {
  try {
    const rows = await withOrg(org, role, (sql) =>
      sql<LiveUser[]>`
        select role, active, session_epoch, mfa_enrolled
          from staff.session_check_for(${uid}, ${org})
      `
    );
    return rows[0] ?? null;
  } catch (err) {
    // A database that cannot be reached must not become a database that
    // says yes. Returning null denies the request, which is the correct
    // direction to fail for an authorization check.
    console.error(
      "[staff-auth] session check failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return null;
  }
});

export type StaffDenial =
  | "no_org"
  | "signed_out"
  | "wrong_org"
  | "revoked"
  | "mfa_required"
  | "mfa_enroll";

type Resolution =
  | { ok: true; ctx: StaffContext }
  | { ok: false; reason: StaffDenial };

/**
 * The full check. Everything except the MFA screens themselves goes
 * through this.
 */
export const resolve = cache(async function resolve(): Promise<Resolution> {
  const pending = await resolvePending();
  if (!pending.ok) return pending;

  // A session that has not presented its second factor can reach the MFA
  // screens and nothing else. It is a half-open door, and treating it as
  // anything more is how a second factor becomes decorative.
  const { session } = pending.ctx;
  if (session.mfa === "pending") {
    return { ok: false, reason: pending.mfaEnrolled ? "mfa_required" : "mfa_enroll" };
  }

  return { ok: true, ctx: pending.ctx };
});

/**
 * Everything resolve() checks EXCEPT the second factor.
 *
 * Only the MFA enrolment and challenge routes may use this — they are the
 * one place where someone legitimately has a valid identity but has not
 * yet completed sign-in.
 */
export const resolvePending = cache(async function resolvePending(): Promise<
  Resolution & { mfaEnrolled?: boolean }
> {
  const session = await currentSession();
  if (!session) return { ok: false, reason: "signed_out" };

  // A platform admin has no org of their own. Until there is a screen for
  // choosing which org to act in, they are treated as signed out rather
  // than silently dropped into somebody's data.
  const org = session.org;
  if (!org) return { ok: false, reason: "no_org" };

  const live = await liveUser(org, session.role, session.uid);
  // The cookie's org is a claim; this is where the database settles it.
  // Deactivated, revoked, or an org the person no longer has any standing
  // in (home or granted) since the cookie was minted — each means the
  // cookie is stale or forged, and each ends the session. session_
  // check_for() already returns no row at all for an org this uid cannot
  // reach, so there is no separate org match to check here.
  if (!live || !live.active || live.session_epoch !== session.ep) {
    return { ok: false, reason: "revoked" };
  }

  // The role in the cookie is a snapshot; the database is current. Someone
  // demoted mid-shift should lose the extra menu on their next click, not
  // at their next sign-in.
  const current: StaffSession = { ...session, role: live.role as StaffSession["role"] };

  return { ok: true, ctx: { session: current, org }, mfaEnrolled: live.mfa_enrolled };
});

/** Redirecting form, for pages. Never returns without a valid context. */
export async function requireStaff(): Promise<StaffContext> {
  const result = await resolve();
  if (result.ok) return result.ctx;
  if (result.reason === "mfa_required") redirect("/staff/mfa");
  if (result.reason === "mfa_enroll") redirect("/staff/mfa/enroll");
  redirect(`/staff/signin?e=${result.reason}`);
}

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { STAFF_COOKIE, verifySession, type StaffSession } from "@/lib/staff/session";
import { withOrg } from "@/lib/staff/db";

// Session + org resolution for server components under /staff.
//
// There are now three independent facts on every staff request — which org
// the URL is for, what the cookie says, and what the database says about
// that user right now — and all three have to agree. Keeping the
// reconciliation in one function is the point: a page that checks two of
// the three is the page that keeps serving a fired employee.
//
// THE DATABASE READ IS NOT OPTIONAL. A signed cookie is a statement about
// the past: it says who this was when they signed in. Deactivation,
// revocation, and role changes all happen after that, so a session that is
// only cryptographically valid is not the same as a session that is still
// allowed. React's cache() dedupes the read within a request, so a layout
// and its page cost one query between them, not two.

export interface StaffContext {
  session: StaffSession;
  /** The org this request is for. Always the host's org, never the
   *  cookie's — see resolve() for why that direction matters. */
  org: string;
}

/**
 * The org this hostname belongs to, from the x-tenant-slug header that
 * proxy.ts already sets for every request on a tenant subdomain.
 *
 * Deliberately reusing that resolution instead of adding a second one:
 * two routers deciding "which org is this" is two places to disagree, and
 * the existing one is the same lookup that decides which brand's portal a
 * visitor sees.
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
  id: string;
  org_slug: string | null;
  role: string;
  active: boolean;
  session_epoch: number;
  mfa_enrolled: boolean;
}

/** The current truth about a user. Cached per request, not across them. */
const liveUser = cache(async function liveUser(
  org: string,
  role: string,
  uid: string
): Promise<LiveUser | null> {
  try {
    const rows = await withOrg(org, role, (sql) =>
      sql<LiveUser[]>`
        select id, org_slug, role, active, session_epoch, mfa_enrolled
          from staff.session_checks where id = ${uid}
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
  const org = await hostOrg();
  // The staff area is per-org and lives on the org's own hostname. On the
  // bare root domain there is no org to scope to, and guessing one from
  // the cookie would let a stale cookie choose the org — the opposite of
  // what we want.
  if (!org) return { ok: false, reason: "no_org" };

  const session = await currentSession();
  if (!session) return { ok: false, reason: "signed_out" };

  // A platform admin is not scoped to one org and may act inside any of
  // them; everyone else must be signed into the org they're looking at.
  if (session.role !== "platform_super_admin" && session.org !== org) {
    return { ok: false, reason: "wrong_org" };
  }

  const live = await liveUser(org, session.role, session.uid);
  // Deleted, deactivated, revoked, or moved to another org since this
  // cookie was minted. Each is a reason the cookie is stale rather than
  // forged, and each ends the session.
  if (
    !live ||
    !live.active ||
    live.session_epoch !== session.ep ||
    (session.role !== "platform_super_admin" && live.org_slug !== org)
  ) {
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

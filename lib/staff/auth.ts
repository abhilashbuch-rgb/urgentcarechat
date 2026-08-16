import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { STAFF_COOKIE, verifySession, type StaffSession } from "@/lib/staff/session";

// Session + org resolution for server components under /staff.
//
// There are two independent facts on every staff request — which org the
// URL is for, and who the cookie says you are — and they have to agree.
// Keeping the reconciliation in one function is the point: a page that
// forgets to compare them would render one org's shell around another
// org's session, and the "which org am I looking at" question would have
// two answers depending on where you asked.

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

export type StaffDenial = "no_org" | "signed_out" | "wrong_org";

/** Non-redirecting form, for route handlers that need to answer with a
 *  status code rather than navigate. */
export async function resolve(): Promise<
  { ok: true; ctx: StaffContext } | { ok: false; reason: StaffDenial }
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

  return { ok: true, ctx: { session, org } };
}

/** Redirecting form, for pages. Never returns without a valid context. */
export async function requireStaff(): Promise<StaffContext> {
  const result = await resolve();
  if (result.ok) return result.ctx;
  redirect(`/staff/signin?e=${result.reason}`);
}

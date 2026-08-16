// Staff session cookie: a small signed payload, no server-side session
// store.
//
// Signed, not encrypted — the contents (user id, org, role, email) are
// things the holder already knows about themselves. What matters is that
// they cannot *change* them: without the HMAC a staffer could edit
// `role` in their own cookie and become an org_admin.
//
// HMAC-SHA256 via Web Crypto rather than a JWT library, because the whole
// job is two functions and a dependency here would be more surface than
// substance. The format is deliberately not a JWT so nobody is tempted to
// hand it to something that accepts `alg: none`.

const COOKIE_NAME = "uc_staff";
const MAX_AGE_SECONDS = 60 * 60 * 12; // one shift, not one month

export const STAFF_COOKIE = COOKIE_NAME;
export const STAFF_COOKIE_MAX_AGE = MAX_AGE_SECONDS;

export type StaffRole =
  | "platform_super_admin"
  | "org_admin"
  | "clinical_lead"
  | "staff";

export interface StaffSession {
  /** staff.users.id */
  uid: string;
  /** staff.orgs.slug — null only for a platform super admin */
  org: string | null;
  role: StaffRole;
  email: string;
  name: string | null;
  /** Unix seconds. */
  exp: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Throws rather than falling back to a default. A signing secret with a
 *  known value is the same as no signature at all, so a missing env var
 *  must stop sign-in, not quietly weaken it. */
function secret(): Uint8Array {
  const raw = process.env.STAFF_SESSION_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "STAFF_SESSION_SECRET is missing or shorter than 32 characters"
    );
  }
  return new TextEncoder().encode(raw);
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    secret() as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSession(
  session: Omit<StaffSession, "exp"> & { exp?: number }
): Promise<string> {
  const payload: StaffSession = {
    ...session,
    exp: session.exp ?? Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign(
    "HMAC",
    await key(),
    new TextEncoder().encode(body) as BufferSource
  );
  return `${body}.${b64urlEncode(new Uint8Array(mac))}`;
}

/** Returns null for anything that isn't a currently-valid session —
 *  malformed, wrong signature, or expired are all the same answer: no
 *  session. Callers never get a partially-trusted result to reason about. */
export async function verifySession(
  token: string | undefined
): Promise<StaffSession | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await key(),
      b64urlDecode(mac) as BufferSource,
      new TextEncoder().encode(body) as BufferSource
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(b64urlDecode(body))
    ) as StaffSession;
    if (!parsed?.uid || !parsed?.role || !parsed?.exp) return null;
    if (parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

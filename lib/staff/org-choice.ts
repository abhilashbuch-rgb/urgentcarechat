// A short-lived signed cookie for the one moment sign-in has proved WHO
// somebody is but not yet WHICH of her linked clinics she means.
//
// Deliberately not a StaffSession — it carries no uid, no role, no org,
// because none of those are decided yet. Reusing StaffSession's shape
// for a state that isn't a session would make every route that reads a
// session responsible for noticing this one is half-formed. A separate,
// narrower cookie means every other route just sees "no session" if it
// looks here at all, and the one route that DOES look — choose-clinic —
// only ever gets a payload proving an identity check already passed.
//
// SAME HMAC PRIMITIVE AS session.ts, copied rather than shared, because
// the two payloads are different shapes and the whole point of a signed
// cookie is that nothing about verifying one can be confused with
// verifying the other.

const COOKIE_NAME = "uc_staff_choice";
const MAX_AGE_SECONDS = 5 * 60; // long enough to read a short list and tap one

export const ORG_CHOICE_COOKIE = COOKIE_NAME;
export const ORG_CHOICE_COOKIE_MAX_AGE = MAX_AGE_SECONDS;

export interface OrgChoice {
  email: string;
  personKey: string;
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

export async function signOrgChoice(
  choice: Omit<OrgChoice, "exp">
): Promise<string> {
  const payload: OrgChoice = {
    ...choice,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign(
    "HMAC",
    await key(),
    new TextEncoder().encode(body) as BufferSource
  );
  return `${body}.${b64urlEncode(new Uint8Array(mac))}`;
}

export async function verifyOrgChoice(
  token: string | undefined
): Promise<OrgChoice | null> {
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
    ) as OrgChoice;
    if (!parsed?.email || !parsed?.personKey || !parsed?.exp) return null;
    if (parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

// TOTP (RFC 6238) — the second factor, owned by us.
//
// WHY NOT JUST RELY ON GOOGLE'S 2FA
// ---------------------------------
// Google's OAuth response does not tell us whether a second factor was
// used. There is no claim for it in the ID token, so "we enforce 2FA via
// Google" is a sentence that cannot be checked by anything in this
// codebase — it is a statement about the customer's Workspace
// configuration, made by us, on their behalf. When an org does run
// Workspace, enforcing 2-step verification there is the right control and
// the hosted-domain check ties sign-in to it. This exists so the guarantee
// does not depend on that: a factor we issue, verify, and can prove was
// presented.
//
// SHA-1 is correct here and is not a weakness — RFC 6238 specifies
// HMAC-SHA1, every authenticator app implements it, and the security of
// TOTP rests on the shared secret and the 30-second window rather than on
// collision resistance.

const DIGITS = 6;
const PERIOD = 30;
/** Accept the neighbouring windows so a phone clock that is a few seconds
 *  out still works. One step either side is ±30s — enough for real clock
 *  drift, small enough that a captured code expires quickly. */
const WINDOW = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(bytes = 20): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(secret: string): Uint8Array {
  // Authenticator apps display the secret in spaced groups and users
  // retype it in lower case, so normalize before decoding rather than
  // rejecting a secret that is correct but formatted for humans.
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / PERIOD);
}

async function codeForStep(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const counter = new Uint8Array(8);
  // Big-endian 64-bit counter. Written from the low end so the top four
  // bytes stay zero, which they will remain until the year 5000-odd.
  let value = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = value & 0xff;
    value = Math.floor(value / 256);
  }

  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, counter as BufferSource)
  );

  // Dynamic truncation, RFC 4226 §5.3.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export interface VerifyResult {
  ok: boolean;
  /** The time step the code belonged to. Store it: a code is valid for its
   *  whole window, so without recording which step was used, the same code
   *  can be presented again within 30 seconds by anyone who saw it. */
  step: number;
}

export async function verifyCode(
  secret: string,
  input: string,
  lastStep: number | null,
  now = Date.now()
): Promise<VerifyResult> {
  const digits = input.replace(/\D/g, "");
  if (digits.length !== DIGITS) return { ok: false, step: 0 };

  const centre = currentStep(now);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const step = centre + delta;
    // Replay guard. Rejecting steps at or below the last accepted one also
    // stops a code being reused from the previous window.
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(await codeForStep(secret, step), digits)) {
      return { ok: true, step };
    }
  }
  return { ok: false, step: 0 };
}

/** Constant-time for equal-length strings. Overkill for a six-digit code
 *  an attacker can only guess 1-in-a-million at, but comparing secrets
 *  with === is a habit worth not having. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The otpauth:// URI an authenticator app scans. The issuer appears in
 *  the app's list, so it says the clinic's name rather than "urgentcare"
 *  — on a phone with a dozen entries that is the difference between
 *  finding the right code and hunting. */
export function otpauthUri(secret: string, email: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params}`;
}

/** Grouped in fours for anyone typing it in by hand because their camera
 *  won't focus or the QR won't render. */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

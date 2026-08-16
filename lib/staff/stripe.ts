// Stripe webhook signature verification.
//
// NO STRIPE SDK, on purpose.
//
// The SDK exists mostly to make API calls, and this integration makes
// none: Stripe Payment Links create the checkout and the no-code Customer
// Portal handles upgrades and cards, both configured in the dashboard.
// What is left is verifying one signature, which is an HMAC — the same
// primitive already used for staff sessions and TOTP in this codebase.
//
// If programmatic checkout is ever needed (usage-based pricing, seats
// counted at renewal), add the SDK then. Right now it would be a
// dependency carried for one function.

const TOLERANCE_SECONDS = 300;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a Stripe-Signature header against the raw request body.
 *
 * THE BODY MUST BE THE RAW TEXT, not a re-serialized parsed object.
 * JSON.stringify(JSON.parse(body)) is not byte-identical to what Stripe
 * signed — key order and whitespace differ — and the signature would fail
 * for reasons that look like a configuration problem.
 *
 * Returns the parsed event only when the signature checks out. An
 * unverified webhook is an unauthenticated stranger claiming a
 * subscription was cancelled.
 */
export async function verifyStripeEvent(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined
): Promise<{ ok: true; event: StripeEvent } | { ok: false; reason: string }> {
  if (!secret) return { ok: false, reason: "no_webhook_secret" };
  if (!signatureHeader) return { ok: false, reason: "no_signature" };

  // t=1699999999,v1=abc...,v1=def...
  let timestamp = "";
  const candidates: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t") timestamp = v;
    else if (k === "v1" && v) candidates.push(v);
  }
  if (!timestamp || candidates.length === 0) {
    return { ok: false, reason: "malformed_signature" };
  }

  // Replay window. Without it, a signature captured once stays valid
  // forever and a recorded "subscription cancelled" can be replayed.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`) as BufferSource
  );
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Stripe sends several v1 signatures during a secret rotation; any match
  // is valid.
  if (!candidates.some((c) => timingSafeEqual(c, expected))) {
    return { ok: false, reason: "signature_mismatch" };
  }

  try {
    return { ok: true, event: JSON.parse(rawBody) as StripeEvent };
  } catch {
    return { ok: false, reason: "bad_json" };
  }
}

// Only the fields this integration reads. Deliberately not the full Stripe
// type surface — an interface that describes what we use is easier to
// check against the dashboard than one that describes everything.
export interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: {
      id?: string;
      customer?: string | { id?: string };
      subscription?: string | { id?: string };
      status?: string;
      client_reference_id?: string | null;
      customer_email?: string | null;
      customer_details?: { email?: string | null; name?: string | null } | null;
      metadata?: Record<string, string> | null;
    };
  };
}

export function idOf(value: string | { id?: string } | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : (value.id ?? null);
}

/** A URL-safe org slug derived from whatever the checkout gave us.
 *  Collisions are resolved in staff.provision_org, not here. */
export function slugFrom(name: string | null, email: string | null): string {
  const source =
    (name && name.trim()) ||
    (email && email.split("@")[1]?.split(".")[0]) ||
    "clinic";
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  // The slug shape proxy.ts accepts is [a-z0-9][a-z0-9-]{1,31}; anything
  // that doesn't survive sanitizing falls back rather than producing a
  // slug that can never route.
  return /^[a-z0-9][a-z0-9-]{1,31}$/.test(slug) ? slug : "clinic";
}

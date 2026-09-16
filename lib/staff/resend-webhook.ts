// Verifying a Resend webhook.
//
// Resend signs webhooks the way Svix does: svix-id, svix-timestamp, and
// svix-signature headers, one or more "v1,<base64>" signatures computed
// over "{svix-id}.{svix-timestamp}.{raw body}" with an HMAC whose key is
// the part of the signing secret after its "whsec_" prefix, base64
// decoded. Hand-verified rather than pulling in the svix package for the
// same reason lib/staff/stripe.ts hand-verifies Stripe's signature: one
// function, no dependency.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const TOLERANCE_SECONDS = 60 * 5;

export interface ResendWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export async function verifyResendWebhook(
  rawBody: string,
  headers: ResendWebhookHeaders,
  secret: string | undefined
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!secret) return { ok: false, reason: "no_webhook_secret" };
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: "missing_headers" };
  }

  const age = Math.abs(Date.now() / 1000 - Number(headers.timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const keyBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${headers.id}.${headers.timestamp}.${rawBody}`) as BufferSource
  );
  const expected = Buffer.from(mac).toString("base64");

  // Several "v1,<sig>" entries can appear space-separated during a
  // secret rotation; any match is valid.
  const candidates = headers.signature
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter((v): v is string => Boolean(v));

  if (!candidates.some((c) => timingSafeEqual(c, expected))) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true };
}

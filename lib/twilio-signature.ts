import crypto from "crypto";

// Twilio's standard webhook signature scheme (documented at
// twilio.com/docs/usage/security#validating-requests): sort all POST
// params alphabetically by key, concatenate each key+value (no
// delimiter) onto the end of the exact webhook URL, HMAC-SHA1 that
// with the Auth Token, base64-encode, compare to X-Twilio-Signature.
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string
): boolean {
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], url);
  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

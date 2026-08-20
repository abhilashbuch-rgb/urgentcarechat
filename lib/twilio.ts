// Sending SMS via Twilio's REST API directly — no SDK dependency.
//
// CONFIGURED-OR-HONEST, the same contract as lib/mail.ts and
// lib/staff/storage.ts. isSmsConfigured() lets a caller behave sensibly
// when the credentials are absent instead of throwing into a cron
// invocation, which matters because alerts are durable queue rows: an
// unconfigured Twilio means SMS stays PENDING and visible, never lost.
//
// CREDENTIALS COME FROM THE ENVIRONMENT AND NOWHERE ELSE. They are never
// stored in the database, never logged, and never included in an error
// message — Twilio's failure bodies are truncated before they reach
// alert_queue.last_error for exactly that reason.

/** True when an SMS can actually be sent. Checked before enqueueing work
 *  rather than discovered inside a failed send. */
export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
}

function twilioAuthHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN env var");
  }
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

// Sends an SMS via Twilio's REST API directly (no SDK dependency needed).
export async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !from) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_FROM_NUMBER env var");
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
      // A ceiling, because this now runs inside an hourly cron sweep
      // alongside other clinics' alerts. Without it one hung connection
      // holds the invocation until the platform kills it, and every
      // remaining alert waits behind that single bad request.
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!res.ok) {
    // Truncated: Twilio echoes request parameters in some error bodies,
    // and this string is persisted to alert_queue.last_error where a
    // person will read it. The status and the leading message are what
    // distinguish "unverified number" from "insufficient funds"; the
    // rest is not worth storing.
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Twilio ${res.status}: ${text}`);
  }
}

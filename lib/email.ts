// ============================================================
// Email — thin wrapper over Resend's REST API (no SDK dependency,
// same pattern as lib/twilio.ts). Used as the universal fallback
// delivery channel for the EMR push: a fax machine or an inbox exists
// at every practice, even ones with no EMR/HIE presence at all, so
// this is the guaranteed floor beneath lib/metriport.ts.
// ============================================================

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email is not configured — set RESEND_API_KEY and RESEND_FROM_ADDRESS.");
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_ADDRESS;
  if (!apiKey || !from) throw new EmailNotConfiguredError();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });

  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }
}

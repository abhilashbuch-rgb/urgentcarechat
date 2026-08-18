// Sending email, or honestly not sending it.
//
// PROVIDER-AGNOSTIC BY NECESSITY: no mail provider is configured on this
// deployment yet. Rather than importing an SDK and failing at runtime,
// this speaks HTTP to whichever provider's key is present, and
// isMailConfigured() lets callers behave sensibly when none is.
//
// THE IMPORTANT PART IS WHAT HAPPENS WHEN IT IS NOT CONFIGURED. Alerts
// are already durable rows in staff.alert_queue by the time this is
// reached — see supabase/staff-alerts.sql. So an unconfigured or
// down provider means alerts QUEUE, visibly, with the attempt count and
// the last error on the row. It does not mean a log submission fails,
// and it does not mean an excursion silently evaporates. The audit
// question "was the medical director told about the 49-degree fridge" is
// answerable either way, which is the whole reason the queue exists.

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

type Provider = "resend" | "postmark" | "sendgrid";

function provider(): { name: Provider; key: string } | null {
  const resend = process.env.RESEND_API_KEY;
  if (resend) return { name: "resend", key: resend };
  const postmark = process.env.POSTMARK_SERVER_TOKEN;
  if (postmark) return { name: "postmark", key: postmark };
  const sendgrid = process.env.SENDGRID_API_KEY;
  if (sendgrid) return { name: "sendgrid", key: sendgrid };
  return null;
}

export function isMailConfigured(): boolean {
  return provider() !== null && Boolean(process.env.ALERT_FROM_EMAIL);
}

/**
 * Send one message. Throws on failure so the caller records the error on
 * the queue row and the sweep retries it — a silent failure here would
 * mark an alert delivered that never arrived, which is the one outcome
 * worse than not sending it.
 */
export async function send(mail: Mail): Promise<void> {
  const p = provider();
  const from = process.env.ALERT_FROM_EMAIL;
  if (!p || !from) throw new Error("mail_not_configured");

  // A 10-second ceiling. Without it a hung provider connection holds the
  // cron invocation until the platform kills it, and every remaining
  // alert in the sweep waits behind one bad request.
  const signal = AbortSignal.timeout(10_000);

  let res: Response;
  if (p.name === "resend") {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${p.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
    });
  } else if (p.name === "postmark") {
    res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      signal,
      headers: {
        "X-Postmark-Server-Token": p.key,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        From: from,
        To: mail.to,
        Subject: mail.subject,
        TextBody: mail.text,
        MessageStream: "outbound",
      }),
    });
  } else {
    res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${p.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: mail.to }] }],
        from: { email: from },
        subject: mail.subject,
        content: [{ type: "text/plain", value: mail.text }],
      }),
    });
  }

  if (!res.ok) {
    // The provider's own message, truncated. It is the difference
    // between "domain not verified" and "rate limited", and it is what
    // lands in alert_queue.last_error for somebody to read.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`${p.name} ${res.status}: ${detail}`);
  }
}

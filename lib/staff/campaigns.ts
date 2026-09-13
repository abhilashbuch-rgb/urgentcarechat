import { withOrg, type StaffSql } from "@/lib/staff/db";
import { isOutreachConfigured, send } from "@/lib/mail";
import { ROOT_URL } from "@/lib/site";

// Outbound email campaigns: multi-step cold outreach, driven by the
// hourly /api/cron/send-campaign-emails sweep. See
// supabase/staff-email-campaigns.sql for the schema, and for why these
// tables carry no org_slug — a prospect isn't a clinic yet.

export interface CampaignSendOutcome {
  recipientId: string;
  email: string;
  step: number;
  ok: boolean;
  error?: string;
}

interface DueRecipient {
  id: string;
  campaign_id: string;
  email: string;
  current_step: number;
  unsubscribe_token: string;
}

interface Step {
  step_number: number;
  delay_days: number;
  subject: string;
  html_body: string;
}

/** Every recipient due for their next step right now, oldest-due
 *  first, capped at `limit`. Capped small on purpose — see the cron
 *  route's own comment on why a cold, newly-warming sending domain
 *  must never see a burst, however many are due at once. */
async function dueRecipients(sql: StaffSql, limit: number): Promise<DueRecipient[]> {
  return sql<DueRecipient[]>`
    select id, campaign_id, email, current_step, unsubscribe_token
      from staff.email_recipients
     where status = 'active' and next_send_at <= now()
     order by next_send_at asc
     limit ${limit}
  `;
}

function withUnsubscribeLink(html: string, token: string): string {
  return html.replaceAll(
    "{{unsubscribe_url}}",
    `${ROOT_URL}/api/unsubscribe?token=${token}`
  );
}

/** A plain-text alternative matters for deliverability as much as the
 *  HTML part does — a message with only an HTML part reads as more
 *  likely spam to several providers' filters. Stripped from the HTML
 *  rather than hand-maintained separately, so the two can never drift
 *  apart. Good enough for a template's own simple markup; not a
 *  general-purpose HTML parser. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&middot;/g, "·")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Sends one recipient's next due step, advances them to whichever
 *  step comes after it (or marks them completed if none does), and
 *  logs the attempt — success or failure — to staff.email_sends. A
 *  send failure leaves next_send_at untouched, so the next hourly
 *  sweep retries it rather than silently dropping the recipient. */
async function sendOneStep(
  sql: StaffSql,
  recipient: DueRecipient,
  from: string
): Promise<CampaignSendOutcome> {
  const stepNumber = recipient.current_step + 1;
  const [step] = await sql<Step[]>`
    select step_number, delay_days, subject, html_body
      from staff.email_campaign_steps
     where campaign_id = ${recipient.campaign_id} and step_number = ${stepNumber}
  `;

  // No further step defined — the sequence is over for this person.
  if (!step) {
    await sql`
      update staff.email_recipients
         set status = 'completed', updated_at = now()
       where id = ${recipient.id}
    `;
    return { recipientId: recipient.id, email: recipient.email, step: stepNumber, ok: true };
  }

  try {
    await send({
      to: recipient.email,
      from,
      subject: step.subject,
      text: htmlToPlainText(step.html_body),
      html: withUnsubscribeLink(step.html_body, recipient.unsubscribe_token),
    });

    // delay_days on the NEXT step is measured from when THIS step was
    // sent, not from enrollment — see staff-email-campaigns.sql.
    const [after] = await sql<{ delay_days: number }[]>`
      select delay_days from staff.email_campaign_steps
       where campaign_id = ${recipient.campaign_id} and step_number = ${stepNumber + 1}
    `;

    if (after) {
      await sql`
        update staff.email_recipients
           set current_step = ${stepNumber},
               next_send_at = now() + (${after.delay_days} || ' days')::interval,
               updated_at = now()
         where id = ${recipient.id}
      `;
    } else {
      await sql`
        update staff.email_recipients
           set current_step = ${stepNumber}, status = 'completed', updated_at = now()
         where id = ${recipient.id}
      `;
    }

    await sql`
      insert into staff.email_sends (recipient_id, step_number, status)
      values (${recipient.id}, ${stepNumber}, 'sent')
    `;
    return { recipientId: recipient.id, email: recipient.email, step: stepNumber, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    await sql`
      insert into staff.email_sends (recipient_id, step_number, status, error)
      values (${recipient.id}, ${stepNumber}, 'failed', ${message})
    `;
    return {
      recipientId: recipient.id,
      email: recipient.email,
      step: stepNumber,
      ok: false,
      error: message,
    };
  }
}

/** Sends up to `limit` due steps in one sweep. Sequential, not
 *  Promise.all — same reasoning as sendEodReports's own sibling in
 *  lib/staff/eod-report.ts: a provider rate limit trips on a burst of
 *  concurrent requests, not on one at a time. Returns [] without
 *  touching any row when outreach isn't configured, so an
 *  unconfigured deployment's cron tick is a clean no-op. */
export async function sendCampaignBatch(limit: number): Promise<CampaignSendOutcome[]> {
  if (!isOutreachConfigured()) return [];
  const from = process.env.OUTREACH_FROM_EMAIL!;

  return withOrg("", "platform_super_admin", async (sql) => {
    const due = await dueRecipients(sql, limit);
    const outcomes: CampaignSendOutcome[] = [];
    for (const r of due) {
      outcomes.push(await sendOneStep(sql, r, from));
    }
    return outcomes;
  });
}

/** The unsubscribe link's whole credential — see app/api/unsubscribe/
 *  route.ts. Idempotent: a token that's already unsubscribed, or
 *  doesn't match anything, is treated as a no-op success either way,
 *  the same "one answer regardless" posture as /report/[token] — a
 *  distinguishing response would confirm which tokens are real. */
export async function unsubscribeByToken(token: string): Promise<void> {
  await withOrg("", "signin", async (sql) => {
    await sql`
      update staff.email_recipients
         set status = 'unsubscribed', updated_at = now()
       where unsubscribe_token = ${token} and status = 'active'
    `;
  });
}

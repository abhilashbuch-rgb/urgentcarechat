import type { StaffSql } from "@/lib/staff/db";
import { isMailConfigured, send } from "@/lib/mail";
import { ROOT_URL } from "@/lib/site";

// Enqueueing alerts, and sweeping the queue.
//
// ENQUEUE RUNS INSIDE THE SUBMITTING TRANSACTION. Sending does not.
// Emailing inline with a log submission would make the mail provider's
// slow afternoon into the medical assistant's slow submit button, and a
// provider outage into either a 500 on an already-filed log or a lost
// excursion alert. See the header of supabase/staff-alerts.sql.

export interface AlertInput {
  org: string;
  kind: "excursion" | "log" | "missed_task" | "credential_expiry";
  subject: string;
  body: string;
  sourceKind?: string;
  sourceId?: string;
  submittedBy?: string;
  payload?: Record<string, unknown>;
}

/** File an alert. Excursions go out immediately; clean logs wait for the
 *  digest unless the clinic has asked for every one. */
export async function enqueue(
  sql: StaffSql,
  input: AlertInput
): Promise<void> {
  const urgency =
    input.kind === "excursion" || input.kind === "missed_task"
      ? "now"
      : await wantsEveryLog(sql, input.org)
        ? "now"
        : "digest";

  // ON CONFLICT DO NOTHING against the unique index: a retried submit or
  // a second browser tab must not send the medical director the same
  // excursion twice. An alert that arrives twice is trusted slightly
  // less than one that arrives once.
  await sql`
    insert into staff.alert_queue
      (org_slug, kind, urgency, subject, body,
       source_kind, source_id, submitted_by, payload)
    values
      (${input.org}, ${input.kind}, ${urgency}, ${input.subject},
       ${input.body}, ${input.sourceKind ?? null},
       ${input.sourceId ?? null}, ${input.submittedBy ?? null},
       ${sql.json((input.payload ?? {}) as Record<string, never>)})
    on conflict do nothing
  `;
}

async function wantsEveryLog(sql: StaffSql, org: string): Promise<boolean> {
  const rows = await sql<{ notify_on_all_logs: boolean }[]>`
    select notify_on_all_logs from staff.orgs where slug = ${org}
  `;
  return rows[0]?.notify_on_all_logs ?? false;
}

export interface SweepResult {
  attempted: number;
  delivered: number;
  failed: number;
  skipped: string | null;
}

/**
 * Deliver everything urgent that has not gone yet.
 *
 * Called from the cron route. Each recipient is tracked separately
 * because the two addresses fail independently — an owner's inbox can
 * bounce while the director's accepts, and one "sent" flag would hide
 * that from the person asking whether the director was told.
 */
export async function sweep(
  sql: StaffSql,
  org: string
): Promise<SweepResult> {
  if (!isMailConfigured()) {
    // Not an error, and nothing is lost: the rows stay queued with their
    // attempt count untouched, so switching a provider on later delivers
    // the backlog rather than starting from empty.
    return { attempted: 0, delivered: 0, failed: 0, skipped: "mail_not_configured" };
  }

  const [orgRow] = await sql<
    {
      name: string;
      owner_alert_email: string | null;
      medical_director_alert_email: string | null;
    }[]
  >`
    select name, owner_alert_email, medical_director_alert_email
      from staff.orgs where slug = ${org}
  `;
  if (!orgRow) return { attempted: 0, delivered: 0, failed: 0, skipped: "no_org" };
  if (!orgRow.owner_alert_email && !orgRow.medical_director_alert_email) {
    return { attempted: 0, delivered: 0, failed: 0, skipped: "no_recipients" };
  }

  const pending = await sql<
    {
      id: string;
      subject: string;
      body: string;
      owner_sent_at: string | null;
      director_sent_at: string | null;
      attempts: number;
    }[]
  >`
    select id, subject, body,
           owner_sent_at::text as owner_sent_at,
           director_sent_at::text as director_sent_at,
           attempts
      from staff.alert_queue
     where org_slug = ${org}
       and urgency = 'now'
       and attempts < 5
       and (
         (${orgRow.owner_alert_email}::text is not null and owner_sent_at is null)
         or (${orgRow.medical_director_alert_email}::text is not null
             and director_sent_at is null)
       )
     order by created_at
     limit 50
  `;

  let delivered = 0;
  let failed = 0;

  for (const row of pending) {
    const errors: string[] = [];
    let ownerOk = row.owner_sent_at !== null;
    let directorOk = row.director_sent_at !== null;

    for (const [addr, already, mark] of [
      [orgRow.owner_alert_email, ownerOk, "owner"] as const,
      [orgRow.medical_director_alert_email, directorOk, "director"] as const,
    ]) {
      if (!addr || already) continue;
      try {
        await send({
          to: addr,
          subject: row.subject,
          text: `${row.body}\n\n${ROOT_URL}/staff`,
        });
        if (mark === "owner") ownerOk = true;
        else directorOk = true;
      } catch (err) {
        errors.push(
          `${mark}: ${err instanceof Error ? err.message : "unknown"}`
        );
      }
    }

    await sql`
      update staff.alert_queue
         set owner_sent_at = ${ownerOk ? sql`coalesce(owner_sent_at, now())` : sql`owner_sent_at`},
             director_sent_at = ${directorOk ? sql`coalesce(director_sent_at, now())` : sql`director_sent_at`},
             attempts = attempts + 1,
             last_error = ${errors.length > 0 ? errors.join("; ").slice(0, 500) : null}
       where id = ${row.id}
    `;

    if (errors.length === 0) delivered += 1;
    else failed += 1;
  }

  return { attempted: pending.length, delivered, failed, skipped: null };
}

/** The AM and PM digest: what got done, what did not, in one message. */
export async function digestFor(
  sql: StaffSql,
  org: string
): Promise<{ subject: string; body: string } | null> {
  const [counts] = await sql<
    { done: number; outstanding: number; flagged: number }[]
  >`
    select
      count(*) filter (where response_id is not null)::int as done,
      count(*) filter (where response_id is null)::int     as outstanding,
      count(*) filter (where has_out_of_range)::int        as flagged
    from staff.todays_logs
   where org_slug = ${org}
  `;
  if (!counts) return null;

  const late = await sql<{ name: string; slot: string }[]>`
    select name, slot from staff.overdue_today where org_slug = ${org}
    order by slot, name
  `;

  // The headline says the answer, not the numbers. Somebody reading this
  // on a phone at 9am wants to know whether to act, and a subject line
  // of "12 logs" makes them open the mail to find out.
  const clean = counts.outstanding === 0 && counts.flagged === 0;
  const subject = clean
    ? `${org}: all clear`
    : `${org}: ${
        counts.flagged > 0 ? `${counts.flagged} out of range` : ""
      }${counts.flagged > 0 && counts.outstanding > 0 ? ", " : ""}${
        counts.outstanding > 0 ? `${counts.outstanding} still due` : ""
      }`;

  const lines = [
    clean
      ? "Everything due today is done and nothing is out of range."
      : "Not everything is done.",
    "",
    `Done: ${counts.done}`,
    `Still due: ${counts.outstanding}`,
    `Out of range: ${counts.flagged}`,
  ];

  if (late.length > 0) {
    lines.push("", "Already late:");
    for (const l of late) lines.push(`  - ${l.name} (${l.slot})`);
  }

  return { subject, body: lines.join("\n") };
}

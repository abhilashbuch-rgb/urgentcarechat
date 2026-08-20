import type { StaffSql } from "@/lib/staff/db";
import { isMailConfigured, send } from "@/lib/mail";
import { isSmsConfigured, sendSms } from "@/lib/twilio";
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

/** How long an amendable excursion waits before it is sent. See the
 *  note at the insert below for why it is three and not ten. */
export const AMEND_HOLD_MINUTES = 3;

/** File an alert. Excursions go out after a short hold; clean logs wait
 *  for the digest unless the clinic has asked for every one. */
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

  // THREE MINUTES BEFORE AN EXCURSION LEAVES THE BUILDING.
  //
  // Long enough for the person who typed 55 instead of 38.5 to notice in
  // the same breath and amend it, which cancels this row before anybody
  // is woken. Short enough that a fridge that really is at 55°F is still
  // savable: the cost of ten minutes' silence is a vaccine lot and a
  // letter to every patient dosed from it.
  //
  // ONLY excursions, and only ones tied to a response — those are the
  // ones an amendment can retract. A missed task has nothing to amend,
  // and holding it would just make the clinic later.
  const holdMinutes =
    input.kind === "excursion" && input.sourceKind === "form_response"
      ? AMEND_HOLD_MINUTES
      : null;

  // ON CONFLICT DO NOTHING against the unique index: a retried submit or
  // a second browser tab must not send the medical director the same
  // excursion twice. An alert that arrives twice is trusted slightly
  // less than one that arrives once.
  await sql`
    insert into staff.alert_queue
      (org_slug, kind, urgency, subject, body,
       source_kind, source_id, submitted_by, payload, hold_until)
    values
      (${input.org}, ${input.kind}, ${urgency}, ${input.subject},
       ${input.body}, ${input.sourceKind ?? null},
       ${input.sourceId ?? null}, ${input.submittedBy ?? null},
       ${sql.json((input.payload ?? {}) as Record<string, never>)},
       ${holdMinutes === null
         ? null
         : sql`now() + (${holdMinutes} || ' minutes')::interval`})
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
  texted: number;
  skipped: string | null;
}

/**
 * The SMS body for an excursion.
 *
 * ONE SEGMENT, and that is a hard design constraint rather than a
 * preference. Over 160 GSM-7 characters Twilio splits the message, and a
 * split alert arrives as two texts that may land out of order — so the
 * half saying "out of range" can arrive after the half saying which
 * fridge. Composed here, capped here.
 *
 * NO PATIENT ANYTHING, EVER. An excursion is about equipment. The body
 * names the clinic, the thing, and the reading, and nothing else has any
 * business in it.
 */
export function excursionSms(org: string, subject: string): string {
  // subject is already "<org>: <template> out of range", built at
  // enqueue time. Trimmed to leave room for the tail.
  const tail = " — check medicin.io/staff";
  const room = 160 - tail.length;
  const head = subject.length > room ? `${subject.slice(0, room - 1)}…` : subject;
  return head + tail;
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
  const mailOn = isMailConfigured();
  const smsOn = isSmsConfigured();
  if (!mailOn && !smsOn) {
    // Not an error, and nothing is lost: the rows stay queued with their
    // attempt count untouched, so switching a provider on later delivers
    // the backlog rather than starting from empty.
    return {
      attempted: 0,
      delivered: 0,
      failed: 0,
      texted: 0,
      skipped: "no_channel_configured",
    };
  }

  const [orgRow] = await sql<
    {
      name: string;
      owner_alert_email: string | null;
      medical_director_alert_email: string | null;
      owner_alert_phone: string | null;
      medical_director_alert_phone: string | null;
    }[]
  >`
    select name, owner_alert_email, medical_director_alert_email,
           owner_alert_phone, medical_director_alert_phone
      from staff.orgs where slug = ${org}
  `;
  if (!orgRow) {
    return { attempted: 0, delivered: 0, failed: 0, texted: 0, skipped: "no_org" };
  }
  const anyRecipient =
    orgRow.owner_alert_email ||
    orgRow.medical_director_alert_email ||
    orgRow.owner_alert_phone ||
    orgRow.medical_director_alert_phone;
  if (!anyRecipient) {
    return {
      attempted: 0,
      delivered: 0,
      failed: 0,
      texted: 0,
      skipped: "no_recipients",
    };
  }

  const pending = await sql<
    {
      id: string;
      kind: string;
      subject: string;
      body: string;
      owner_sent_at: string | null;
      director_sent_at: string | null;
      owner_sms_sent_at: string | null;
      director_sms_sent_at: string | null;
      attempts: number;
    }[]
  >`
    select id, kind, subject, body,
           owner_sent_at::text as owner_sent_at,
           director_sent_at::text as director_sent_at,
           owner_sms_sent_at::text as owner_sms_sent_at,
           director_sms_sent_at::text as director_sms_sent_at,
           attempts
      from staff.alert_queue
     where org_slug = ${org}
       and urgency = 'now'
       and attempts < 5
       -- Without these two lines the hold is decorative: the sweep would
       -- pick the row up on its next pass regardless, and a cancelled
       -- alert would still be delivered.
       and cancelled_at is null
       and (hold_until is null or hold_until <= now())
       and (
         (${orgRow.owner_alert_email}::text is not null and owner_sent_at is null)
         or (${orgRow.medical_director_alert_email}::text is not null
             and director_sent_at is null)
         -- SMS is excursion-only, so the pending test is too. Without
         -- the kind filter every digest and late-task row would look
         -- like it had an outstanding SMS forever and be retried until
         -- it hit the attempt cap.
         or (kind = 'excursion'
             and ${orgRow.owner_alert_phone}::text is not null
             and owner_sms_sent_at is null)
         or (kind = 'excursion'
             and ${orgRow.medical_director_alert_phone}::text is not null
             and director_sms_sent_at is null)
       )
     order by created_at
     limit 50
  `;

  let delivered = 0;
  let failed = 0;
  let texted = 0;

  for (const row of pending) {
    const errors: string[] = [];
    let ownerOk = row.owner_sent_at !== null;
    let directorOk = row.director_sent_at !== null;
    let ownerSmsOk = row.owner_sms_sent_at !== null;
    let directorSmsOk = row.director_sms_sent_at !== null;

    // Did this pass actually TRY to send anything, and did anything land?
    //
    // Both counters are needed, and the first version had neither. It
    // reported delivered++ whenever no error was collected — so with the
    // mail provider switched off, three late-task rows that nobody
    // attempted came back as "delivered: 3". A sweep that reports
    // delivering messages it never sent is worse than one that reports
    // nothing, because it is the number somebody checks to confirm the
    // owner was told.
    let attemptedAny = false;
    let sentAny = false;

    // --- email ---
    if (mailOn) {
      for (const [addr, already, mark] of [
        [orgRow.owner_alert_email, ownerOk, "owner"] as const,
        [orgRow.medical_director_alert_email, directorOk, "director"] as const,
      ]) {
        if (!addr || already) continue;
        attemptedAny = true;
        try {
          await send({
            to: addr,
            subject: row.subject,
            text: `${row.body}\n\n${ROOT_URL}/staff`,
          });
          if (mark === "owner") ownerOk = true;
          else directorOk = true;
          sentAny = true;
        } catch (err) {
          errors.push(
            `email ${mark}: ${err instanceof Error ? err.message : "unknown"}`
          );
        }
      }
    }

    // --- SMS, EXCURSIONS ONLY ---
    //
    // See the header of supabase/staff-alerts-sms.sql. SMS is the channel
    // with no filter: somebody who gets a text for every log has to turn
    // the channel off entirely, and turning it off takes the fridge alert
    // with it.
    if (smsOn && row.kind === "excursion") {
      const text = excursionSms(org, row.subject);
      for (const [num, already, mark] of [
        [orgRow.owner_alert_phone, ownerSmsOk, "owner"] as const,
        [
          orgRow.medical_director_alert_phone,
          directorSmsOk,
          "director",
        ] as const,
      ]) {
        if (!num || already) continue;
        attemptedAny = true;
        try {
          await sendSms(num, text);
          if (mark === "owner") ownerSmsOk = true;
          else directorSmsOk = true;
          texted += 1;
          sentAny = true;
        } catch (err) {
          errors.push(
            `sms ${mark}: ${err instanceof Error ? err.message : "unknown"}`
          );
        }
      }
    }

    // Four independent outcomes. An owner's email can accept while their
    // SMS is rejected for an unverified number, and one "sent" flag would
    // hide that from whoever asks whether the director was told.
    await sql`
      update staff.alert_queue
         set owner_sent_at = ${ownerOk ? sql`coalesce(owner_sent_at, now())` : sql`owner_sent_at`},
             director_sent_at = ${directorOk ? sql`coalesce(director_sent_at, now())` : sql`director_sent_at`},
             owner_sms_sent_at = ${ownerSmsOk ? sql`coalesce(owner_sms_sent_at, now())` : sql`owner_sms_sent_at`},
             director_sms_sent_at = ${directorSmsOk ? sql`coalesce(director_sms_sent_at, now())` : sql`director_sms_sent_at`},
             -- Incremented only when something was actually tried. A
             -- row that could not be attempted at all — no channel
             -- configured for it yet — must not burn its five attempts
             -- waiting for a provider key, or the backlog is already
             -- dead by the time one is set.
             attempts = attempts + ${attemptedAny ? 1 : 0},
             last_error = ${errors.length > 0 ? errors.join("; ").slice(0, 500) : null}
       where id = ${row.id}
    `;

    if (!attemptedAny) continue;
    if (sentAny && errors.length === 0) delivered += 1;
    else failed += 1;
  }

  return { attempted: pending.length, delivered, failed, texted, skipped: null };
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

  // Filed away from the clinic today. Previously this reached the owner
  // only through staff.off_site_filings or the scheduled report — so a
  // reading entered from a car park was invisible to anybody who reads
  // the twice-daily digest and nothing else, which is most owners.
  const offSite = await sql<
    {
      form_name: string;
      filed_by: string | null;
      location_status: string;
      distance_m: number | null;
      location_note: string | null;
    }[]
  >`
    select form_name, filed_by, location_status, distance_m, location_note
      from staff.off_site_today where org_slug = ${org}
  `;

  // Anybody running silent during clinic hours. See the header of
  // supabase/staff-audio-audit.sql for why this is reported rather than
  // prevented — the short version is that no browser can be made to
  // play a sound, so a lock would be a promise the software cannot keep.
  const silent = await sql<
    { legal_name: string | null; minutes_off: number; during_hours: boolean }[]
  >`
    select legal_name, minutes_off, during_hours
      from staff.audio_off_now where org_slug = ${org} and during_hours
     order by minutes_off desc
  `;

  // The headline says the answer, not the numbers. Somebody reading this
  // on a phone at 9am wants to know whether to act, and a subject line
  // of "12 logs" makes them open the mail to find out.
  const clean =
    counts.outstanding === 0 &&
    counts.flagged === 0 &&
    offSite.length === 0;
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

  if (offSite.length > 0) {
    lines.push("", "Filed away from the clinic:");
    for (const o of offSite) {
      const where =
        o.location_status === "denied"
          ? "location declined"
          : o.distance_m === null
            ? "off site"
            : `${o.distance_m} m away`;
      lines.push(`  ${o.form_name} — ${o.filed_by ?? "unknown"} (${where})`);
      // The reason they gave, indented under it. Without this the owner
      // sees a distance and has to open the app to learn it was a phone
      // with no signal until the car park.
      if (o.location_note) lines.push(`    "${o.location_note}"`);
    }
  }

  if (silent.length > 0) {
    lines.push("", "Shift sound off during clinic hours:");
    for (const p of silent) {
      lines.push(
        `  ${p.legal_name ?? "unnamed"} — ${p.minutes_off} min`
      );
    }
    lines.push(
      "  (Reminders still appear on screen. Sound cannot be forced on by",
      "   the app — a device on silent stays silent.)"
    );
  }

  if (late.length > 0) {
    lines.push("", "Already late:");
    for (const l of late) lines.push(`  - ${l.name} (${l.slot})`);
  }

  return { subject, body: lines.join("\n") };
}

/**
 * The stamp that goes in an alert's subject line: who filed it and when,
 * in the CLINIC's timezone.
 *
 * WHY THE SUBJECT AND NOT JUST THE BODY. An owner reads the subject on a
 * lock screen and decides from that whether to open anything. "Fridge out
 * of range" tells them something is wrong; "Fridge out of range —
 * R. Alvarez, Aug 20 2:14pm" tells them who to ask and whether it is
 * happening now or happened while they were asleep. That is the whole
 * decision, made without unlocking the phone.
 *
 * THE CLINIC'S TIMEZONE, NOT THE SERVER'S AND NOT THE READER'S.
 * formatSignedAt hardcodes America/New_York, which is correct for
 * exactly the clinics in Eastern time and silently wrong for everyone
 * else — a 7am fridge check in Phoenix would read as 10am. The org row
 * carries the real zone; it is passed in rather than looked up here so
 * this stays a pure function.
 *
 * No year: an alert is read the day it arrives, and the subject line has
 * about forty characters of visible room on a phone.
 */
export function localStamp(timezone: string, at: Date = new Date()): string {
  try {
    // THE DATE IS DROPPED WHEN THE EVENT IS TODAY, and that is not
    // cosmetic. A phone lock screen shows roughly forty characters of a
    // subject line; "Aug 20, " is eight of them, and spending them on a
    // date the reader can infer pushed the STAFF MEMBER'S NAME off the
    // end — the one thing this stamp exists to surface. An immediate
    // alert is about something that happened minutes ago; anything older
    // still carries its date, because then it genuinely is ambiguous.
    const today =
      new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at) ===
      new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      ...(today ? {} : { month: "short", day: "numeric" }),
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  } catch {
    // An invalid IANA name must not cost the clinic its alert. Fall back
    // to UTC and say so, rather than throwing inside a submit handler.
    return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

export function whoAndWhen(
  name: string | null,
  email: string,
  timezone: string,
  at: Date = new Date()
): string {
  // The display name where there is one; the address is a poor substitute
  // in a subject line but better than "somebody".
  return `${name ?? email} · ${localStamp(timezone, at)}`;
}

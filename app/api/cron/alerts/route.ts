import { NextRequest, NextResponse } from "next/server";
import { withOrg, isDatabaseConfigured } from "@/lib/staff/db";
import { sweep, digestFor, enqueue, localStamp } from "@/lib/staff/alerts";
import { SLOT_LABELS } from "@/lib/staff/forms";
import { huddleRecipientsToday, huddleFor, followUpFor, type FollowUpTier } from "@/lib/staff/huddle";
import { isMailConfigured, send } from "@/lib/mail";
import { detectAndRecordMissedShifts } from "@/lib/staff/shift-miss";

// GET /api/cron/alerts — deliver queued alerts, and file the digests.
//
// Runs hourly. Four things happen, in this order:
//
//   1. Urgent alerts that have not gone yet are sent. Excursions and
//      missed tasks, individually, immediately.
//   2. Tasks that have become late since the last run are enqueued as
//      urgent. Derived from the clinic's own clock, so nothing here can
//      go stale.
//   3. If this hour matches the clinic's AM or PM digest time, AND that
//      digest is switched on (digest_am_enabled/digest_pm_enabled —
//      owner-only, see /staff/settings), one whole-clinic summary is
//      enqueued and sent — except to admin accounts on the PM run, who
//      get the same evening's numbers as the fuller EOD report instead
//      (see the note where optedIn is built, below; that report has its
//      own cron and its own mandatory delivery, untouched by either
//      enabled flag).
//   4. If this hour matches the clinic's morning-huddle time, one
//      good-morning email goes to each person scheduled to work today —
//      see lib/staff/huddle.ts. Its own time, not digest_am_at: a clinic
//      can want the huddle at 8 and the digest at 9.
//   5. If this hour matches checkin_1_at or checkin_2_at, an escalating
//      "still not done" reminder goes to whoever still has something
//      due or late at that hour — nobody who has already finished. See
//      followUpFor() and supabase/staff-task-followups.sql.
//
// WHY HOURLY AND NOT EVERY MINUTE. The two things people actually need
// are "tell me now" for an excursion and "tell me at 9 and at 5" for
// everything else. Hourly serves both — an excursion goes out within the
// hour and the digests land on their hour — and a minute-by-minute cron
// on a serverless platform is sixty invocations an hour to usually do
// nothing.
//
// AUTHENTICATION. Vercel signs its cron requests, and this route also
// accepts a shared secret so it can be exercised by hand. Without either
// it refuses: an open endpoint that sends email to a clinic's owner is a
// way to send email to a clinic's owner.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "no_database" }, { status: 503 });
  }

  // Runs as the platform, not as a user, so it iterates orgs explicitly
  // and sets the org context per iteration. There is no session here to
  // derive it from, which is exactly why withOrg exists.
  const orgs = await withOrg("", "platform_super_admin", (sql) =>
    sql<{
      slug: string;
      due: boolean;
      pmDue: boolean;
      huddleDue: boolean;
      checkin1Due: boolean;
      checkin2Due: boolean;
      timezone: string;
      facilityType: string | null;
    }[]>`
      select slug, timezone, facility_type as "facilityType",
             -- Is this the hour of a digest THAT IS SWITCHED ON, in the
             -- clinic's own zone? digest_am_enabled/digest_pm_enabled
             -- are ANDed in here rather than checked separately in JS,
             -- so an owner who has turned a run off gets exactly the
             -- same result as if that hour never matched at all.
             (
               (
                 date_trunc('hour', now() at time zone timezone)
                   = date_trunc('hour', (now() at time zone timezone)::date + digest_am_at)
                 and digest_am_enabled
               )
               or
               (
                 date_trunc('hour', now() at time zone timezone)
                   = date_trunc('hour', (now() at time zone timezone)::date + digest_pm_at)
                 and digest_pm_enabled
               )
             ) as due,
             -- The PM half specifically — see the "admins" branch below
             -- for why this needs to be its own flag rather than folded
             -- into "due". Turning digest_pm_enabled off here only stops
             -- THIS whole-clinic digest; sendEodReports() (a separate
             -- cron, a separate mandatory email) still fires at
             -- digest_pm_at regardless — see staff-alerts.sql.
             (
               date_trunc('hour', now() at time zone timezone)
                 = date_trunc('hour', (now() at time zone timezone)::date + digest_pm_at)
               and digest_pm_enabled
             ) as "pmDue",
             -- Same test, against the morning-huddle time. Its own
             -- column rather than reusing digest_am_at: the owner may
             -- want the digest at 9 and the huddle at 8, which is
             -- exactly what they asked for.
             (
               date_trunc('hour', now() at time zone timezone)
                 = date_trunc('hour', (now() at time zone timezone)::date + huddle_at)
             ) as "huddleDue",
             -- Same test, against the two escalating check-in times.
             (
               date_trunc('hour', now() at time zone timezone)
                 = date_trunc('hour', (now() at time zone timezone)::date + checkin_1_at)
             ) as "checkin1Due",
             (
               date_trunc('hour', now() at time zone timezone)
                 = date_trunc('hour', (now() at time zone timezone)::date + checkin_2_at)
             ) as "checkin2Due"
        from staff.orgs
       where active
    `
  );

  const results: Record<string, unknown>[] = [];

  for (const { slug, due, pmDue, huddleDue, checkin1Due, checkin2Due, timezone, facilityType } of orgs) {
    try {
      const outcome = await withOrg(slug, "platform_super_admin", async (sql) => {
        // Newly-late tasks. The unique index on (org, source_kind,
        // source_id, kind) means a task that is still late next hour
        // does not generate a second alert — the owner is told once,
        // not once an hour until somebody does it.
        const late = await sql<{ template_id: string; name: string; slot: string }[]>`
          select template_id, name, slot from staff.overdue_today
        `;
        const nowLocal = localStamp(timezone);

        for (const t of late) {
          // SLOT_LABELS[""] is "Today" — a once-a-day template has no
          // AM/PM to show, and t.slot.toUpperCase() used to run straight
          // into the subject/body anyway, producing a blank "()" instead.
          const slotLabel = SLOT_LABELS[t.slot] ?? t.slot.toUpperCase();
          await enqueue(sql, {
            org: slug,
            kind: "missed_task",
            // NO NAME IN THIS ONE, DELIBERATELY. Every other alert names
            // the person who filed the entry; a missed task has nobody to
            // name, and putting the on-shift staff member's name on
            // "nobody did this" attributes a failure that may not be
            // theirs. The slot and the hour are what an owner acts on.
            subject: `NOT LOGGED · ${nowLocal} · ${t.name} (${slotLabel}) · ${slug}`,
            body: `${t.name} (${slotLabel}) has not been logged and is now late.`,
            sourceKind: "late_template",
            sourceId: t.template_id,
          });
        }

        // Entire-shift misses: a role whose whole slot filed nothing at
        // all today, not just one late template. Idempotent — see the
        // header of lib/staff/shift-miss.ts — so trying this every hour
        // costs nothing and records/alerts on each miss exactly once.
        const missedShifts = await detectAndRecordMissedShifts(sql, slug, facilityType);

        if (due) {
          const d = await digestFor(sql, slug);
          if (d) {
            await enqueue(sql, {
              org: slug,
              kind: "log",
              subject: d.subject,
              body: d.body,
              html: d.html,
            });
            // A digest is time-sensitive by definition, so it goes on
            // this sweep rather than waiting for the next one.
            await sql`
              update staff.alert_queue set urgency = 'now'
               where org_slug = ${slug} and subject = ${d.subject}
                 and owner_sent_at is null and director_sent_at is null
            `;

            // Anyone who opted in. Best-effort, not queued: this is the
            // one notification in the whole module that IS a preference,
            // so a single provider hiccup costs a reader one digest, not
            // a retried alert somebody is relying on. sweep() below still
            // owns the owner/director copy, with its usual retries.
            //
            // ORG_ADMIN / PLATFORM_SUPER_ADMIN SKIPPED ON THE PM RUN,
            // SPECIFICALLY. sendEodReports() (lib/staff/eod-report.ts,
            // fired by the same digest_pm_at hour from
            // app/api/cron/reports/route.ts) already sends every admin
            // account the same evening's out-of-range/late/off-site/
            // who-filed-what content, as a PDF they cannot opt out of —
            // "administering the clinic carries seeing this by default,"
            // per that file's own header. Sending the HTML digest too
            // was the same evening's numbers twice, in two formats, to
            // the same inbox. The AM run is untouched: there is no
            // morning EOD report to duplicate.
            if (isMailConfigured()) {
              const optedIn = pmDue
                ? await sql<{ email: string }[]>`
                    select email from staff.users
                     where org_slug = ${slug} and active and wants_digest
                       and role not in ('org_admin', 'platform_super_admin')
                  `
                : await sql<{ email: string }[]>`
                    select email from staff.users
                     where org_slug = ${slug} and active and wants_digest
                  `;
              for (const { email } of optedIn) {
                await send({ to: email, subject: d.subject, text: d.body, html: d.html }).catch(
                  (err) =>
                    console.error(
                      `[cron-alerts] digest to ${email} failed:`,
                      err instanceof Error ? err.message : "Unknown"
                    )
                );
              }
            }
          }
        }

        // The morning huddle: one email per person scheduled to work
        // today, not the whole-clinic digest above. Best-effort, same as
        // the opted-in digest copies just above — this is the one
        // message in the whole cron where a single provider hiccup
        // costs one reader one morning's email, not a retried alert.
        let huddled = 0;
        if (huddleDue && isMailConfigured()) {
          const recipients = await huddleRecipientsToday(sql, slug);
          for (const r of recipients) {
            try {
              const h = await huddleFor(sql, slug, r, timezone, facilityType);
              await send({ to: r.email, subject: h.subject, text: h.body, html: h.html });
              huddled += 1;
            } catch (err) {
              console.error(
                `[cron-alerts] huddle to ${r.email} failed:`,
                err instanceof Error ? err.message : "Unknown"
              );
            }
          }
        }

        // The escalating check-ins: same recipient pool as the huddle
        // (scheduled today), but followUpFor() itself decides who
        // actually gets one — anyone with nothing outstanding gets
        // nothing, silently.
        let checkedIn = 0;
        const dueTier: FollowUpTier | null = checkin1Due ? "noon" : checkin2Due ? "afternoon" : null;
        if (dueTier && isMailConfigured()) {
          const recipients = await huddleRecipientsToday(sql, slug);
          for (const r of recipients) {
            try {
              const f = await followUpFor(sql, slug, r, dueTier);
              if (!f) continue;
              await send({ to: r.email, subject: f.subject, text: f.body, html: f.html });
              checkedIn += 1;
            } catch (err) {
              console.error(
                `[cron-alerts] check-in to ${r.email} failed:`,
                err instanceof Error ? err.message : "Unknown"
              );
            }
          }
        }

        return {
          ...(await sweep(sql, slug)),
          huddled,
          checkedIn,
          missedShifts: missedShifts.filter((m) => m.recorded).length,
        };
      });
      results.push({ org: slug, ...outcome });
    } catch (err) {
      // One clinic's misconfigured recipient must not stop every other
      // clinic's excursion alerts on the same invocation.
      console.error(
        `[cron-alerts] ${slug} failed:`,
        err instanceof Error ? err.message : "Unknown"
      );
      results.push({ org: slug, error: true });
    }
  }

  return NextResponse.json({ ok: true, orgs: results });
}

function authorised(req: NextRequest): boolean {
  // Vercel Cron sets this on its own invocations.
  if (req.headers.get("x-vercel-cron")) return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

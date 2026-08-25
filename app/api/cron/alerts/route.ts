import { NextRequest, NextResponse } from "next/server";
import { withOrg, isDatabaseConfigured } from "@/lib/staff/db";
import { sweep, digestFor, enqueue, localStamp } from "@/lib/staff/alerts";
import { isMailConfigured, send } from "@/lib/mail";

// GET /api/cron/alerts — deliver queued alerts, and file the digests.
//
// Runs hourly. Three things happen, in this order:
//
//   1. Urgent alerts that have not gone yet are sent. Excursions and
//      missed tasks, individually, immediately.
//   2. Tasks that have become late since the last run are enqueued as
//      urgent. Derived from the clinic's own clock, so nothing here can
//      go stale.
//   3. If this hour matches the clinic's AM or PM digest time, one
//      summary is enqueued and sent.
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
    sql<{ slug: string; due: boolean; timezone: string }[]>`
      select slug, timezone,
             -- Is this the hour of a digest, in the clinic's own zone?
             (
               date_trunc('hour', now() at time zone timezone)
                 = date_trunc('hour', (now() at time zone timezone)::date + digest_am_at)
               or
               date_trunc('hour', now() at time zone timezone)
                 = date_trunc('hour', (now() at time zone timezone)::date + digest_pm_at)
             ) as due
        from staff.orgs
       where active
    `
  );

  const results: Record<string, unknown>[] = [];

  for (const { slug, due, timezone } of orgs) {
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
          await enqueue(sql, {
            org: slug,
            kind: "missed_task",
            // NO NAME IN THIS ONE, DELIBERATELY. Every other alert names
            // the person who filed the entry; a missed task has nobody to
            // name, and putting the on-shift staff member's name on
            // "nobody did this" attributes a failure that may not be
            // theirs. The slot and the hour are what an owner acts on.
            subject: `NOT LOGGED · ${nowLocal} · ${t.name} (${t.slot.toUpperCase()}) · ${slug}`,
            body: `${t.name} (${t.slot.toUpperCase()}) has not been logged and is now late.`,
            sourceKind: "late_template",
            sourceId: t.template_id,
          });
        }

        if (due) {
          const d = await digestFor(sql, slug);
          if (d) {
            await enqueue(sql, {
              org: slug,
              kind: "log",
              subject: d.subject,
              body: d.body,
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
            if (isMailConfigured()) {
              const optedIn = await sql<{ email: string }[]>`
                select email from staff.users
                 where org_slug = ${slug} and active and wants_digest
              `;
              for (const { email } of optedIn) {
                await send({ to: email, subject: d.subject, text: d.body }).catch(
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

        return sweep(sql, slug);
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

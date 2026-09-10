import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { isMailConfigured, send } from "@/lib/mail";
import { whoAndWhen } from "@/lib/staff/alerts";

// POST /api/staff/logs/notify-now — an immediate email, right now, not
// the hourly sweep.
//
// SEPARATE FROM /api/staff/logs/submit, SAME REASON AS /photo AND
// /field-capture: called only after the log is already saved, and a
// failure here must never look like a failed log. The standard excursion
// alert is still enqueued exactly as before inside submit — this is an
// ADDITIONAL, best-effort instant ping, not a replacement for it. If
// this request fails outright or no mail provider is configured, the
// usual alert still reaches the owner within the hour, same as any other
// excursion.
//
// WHY THIS EXISTS AT ALL: a corrective action that says "notified the
// owner directly" is, on its own, exactly the kind of unverifiable claim
// this product's whole design refuses to accept at face value elsewhere.
// This turns it into something true and provable — an owner who is
// actually paged, and a timestamp on the record showing it happened.
//
// NEVER SENT SYNCHRONOUSLY FROM SUBMIT. Same principle as the excursion
// queue: emailing inline with the log's own request would make the mail
// provider's slow afternoon into the medical assistant's slow submit
// button. This route exists so that risk lives in a request nobody is
// waiting on.

export const runtime = "nodejs";

const RESPONSE_ID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  const { session, org } = auth.ctx;

  const body = await req.json().catch(() => null);
  const responseId =
    body && typeof body.responseId === "string" ? body.responseId : "";
  if (!RESPONSE_ID_RE.test(responseId)) {
    return NextResponse.json({ error: "bad_response_id" }, { status: 400 });
  }

  return withSession(session, async (sql) => {
    // Re-verified here, not trusted from the client — exactly the same
    // discipline as the range check itself in submit/route.ts. A client
    // that believes something was flagged does not get to page an owner
    // about a log that was not.
    const [row] = await sql<
      {
        form_name: string;
        slot: string | null;
        corrective_action: string | null;
        has_out_of_range: boolean;
        submitted_at: string;
        filed_by: string | null;
      }[]
    >`
      select form_name, slot, corrective_action, has_out_of_range,
             submitted_at::text as submitted_at, filed_by
        from staff.report_log_rows
       where id = ${responseId} and org_slug = ${org}
    `;
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!row.has_out_of_range) {
      return NextResponse.json({ error: "not_flagged" }, { status: 400 });
    }

    const [orgRow] = await sql<
      {
        timezone: string;
        owner_alert_email: string | null;
        medical_director_alert_email: string | null;
      }[]
    >`
      select timezone, owner_alert_email, medical_director_alert_email
        from staff.orgs where slug = ${org}
    `;

    const addresses = [
      orgRow?.owner_alert_email,
      orgRow?.medical_director_alert_email,
    ].filter((a): a is string => Boolean(a));

    const stamp = whoAndWhen(
      row.filed_by,
      session.email,
      orgRow?.timezone ?? "UTC",
      new Date(row.submitted_at)
    );
    const subject = `NOTIFIED NOW · ${stamp} · ${row.form_name} · ${org}`;
    const text = [
      `${row.form_name}${row.slot ? ` (${row.slot.toUpperCase()})` : ""} was out of range.`,
      `Filed by ${stamp}.`,
      "",
      `They recorded: ${row.corrective_action ?? ""}`,
      "",
      "This is a direct, immediate notification, sent because the",
      "corrective action said you were told directly — not the usual",
      "digest.",
    ].join("\n");

    const mailOn = isMailConfigured();
    const results: { to: string; ok: boolean }[] = [];
    if (mailOn) {
      for (const to of addresses) {
        try {
          await send({ to, subject, text });
          results.push({ to, ok: true });
        } catch (err) {
          results.push({ to, ok: false });
          console.error(
            "[notify-now] send failed:",
            to,
            err instanceof Error ? err.message : "unknown"
          );
        }
      }
    }

    // Answerable later regardless of outcome: "was this actually sent"
    // should never depend on somebody's memory of a fire-and-forget call.
    await sql`
      insert into staff.audit_log
        (org_slug, actor_id, action, entity, entity_id, detail)
      values
        (${org}, ${session.uid}, 'immediate_notify_sent', 'form_response',
         ${responseId},
         ${sql.json({ mail_configured: mailOn, addresses: results })})
    `;

    return NextResponse.json({ ok: true, sent: results });
  });
}

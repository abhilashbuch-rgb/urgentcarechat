import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { enqueue } from "@/lib/staff/alerts";
import { loadTemplate, ensureInstance } from "@/lib/staff/logs";
import { coerce, evaluate, type Answers } from "@/lib/staff/forms";

// POST /api/staff/logs/submit
//
// The client's idea of what is out of range is a convenience for the
// person filling the form in. This is the version that counts: the
// template is re-read from the database, every value is coerced to the
// type its field declares, and the range check is re-run here. A client
// that decided nothing was wrong does not get to file a clean record of
// an alarming reading.

export const runtime = "nodejs";

const MAX_CORRECTIVE = 2000;
/** Enough room for what was actually done. Matches the CHECK in
 *  supabase/staff-corrective-action.sql — the constraint is what makes
 *  it true of every row however it arrived. */
const MIN_CORRECTIVE = 20;

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  const { session, org } = auth.ctx;

  let body: {
    slug?: string;
    slot?: string;
    answers?: Record<string, unknown>;
    correctiveAction?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug : "";
  const slot = body.slot === "am" || body.slot === "pm" ? body.slot : "";
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });

  try {
    const result = await withSession(session, async (sql) => {
      // The name that goes in the alert. An owner reading "out of range"
      // on their phone needs to know who filed it without opening the
      // app, and an email address is not the name they know people by.
      const [who] = await sql<{ legal_name: string | null }[]>`
        select legal_name from staff.users where id = ${session.uid}
      `;
      const profileName = who?.legal_name ?? null;

      const template = await loadTemplate(sql, slug);
      if (!template) return { error: "no_such_form" as const, status: 404 };

      // A twice-daily form filed with no slot, or a once-a-day form filed
      // as "pm", would silently become a different record than the board
      // is tracking.
      if (template.slots.length > 0 && !template.slots.includes(slot)) {
        return { error: "bad_slot" as const, status: 400 };
      }

      const answers: Answers = {};
      for (const field of template.schema.fields) {
        answers[field.id] = coerce(field, body.answers?.[field.id]);
      }

      const check = evaluate(template.schema, answers);
      if (check.missing.length > 0) {
        return { error: "incomplete" as const, status: 400, missing: check.missing };
      }

      const corrective = (body.correctiveAction ?? "").trim().slice(0, MAX_CORRECTIVE);
      const flagged = check.outOfRange.length > 0;
      // Mirrors the CHECK constraint on the table. Reaching the constraint
      // would also stop it, but a 400 with a reason is a better answer
      // than a 500 from a violated constraint.
      //
      // TWENTY, not three. Three characters stopped an empty field and
      // nothing else: a vaccine fridge at 52 degF with "n/a" in this
      // box was accepted, flagged and filed. That is worse than a
      // missing corrective action, because a missing one reads as an
      // incomplete record and gets chased, while "n/a" reads as a
      // complete one and gets filed — and is what a surveyor finds next
      // to a 52-degree reading three years later. See
      // supabase/staff-corrective-action.sql.
      if (flagged && corrective.length < MIN_CORRECTIVE) {
        return { error: "corrective_action_required" as const, status: 400 };
      }

      const instanceId = await ensureInstance(sql, org, template.id, slot);

      const inserted = await sql<{ id: string }[]>`
        insert into staff.form_responses
          (instance_id, org_slug, submitted_by, answers_json, status,
           has_out_of_range, out_of_range_fields, corrective_action)
        values
          (${instanceId}, ${org}, ${session.uid}, ${sql.json(answers)},
           ${flagged ? "flagged" : "pending"}, ${flagged},
           ${check.outOfRange}, ${flagged ? corrective : null})
        returning id
      `;

      await sql`
        update staff.form_instances
           set status = ${flagged ? "flagged" : "submitted"}
         where id = ${instanceId}
      `;

      await sql`
        insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
        values (${org}, ${session.uid},
                ${flagged ? "log_submitted_out_of_range" : "log_submitted"},
                'form_response', ${inserted[0].id},
                ${sql.json({ slug, slot, out_of_range: check.outOfRangeLabels })})
      `;

      // The alert is enqueued INSIDE this transaction, so an excursion
      // and the record of having raised it either both exist or neither
      // does. Sending happens later, from the cron sweep — emailing here
      // would make the mail provider's slow afternoon into this person's
      // slow submit button, and a provider outage into either a 500 on
      // an already-filed log or a silently lost excursion.
      await enqueue(sql, {
        org,
        kind: flagged ? "excursion" : "log",
        subject: flagged
          ? `${org}: ${template.name} out of range`
          : `${org}: ${template.name} logged`,
        body: flagged
          ? [
              `${template.name} (${slot.toUpperCase()}) is out of range.`,
              `Out of range: ${check.outOfRangeLabels.join(", ")}`,
              `Filed by ${profileName ?? session.email} at ${new Date().toISOString()}`,
              "",
              `Corrective action recorded: ${corrective}`,
            ].join("\n")
          : `${template.name} (${slot.toUpperCase()}) logged by ${profileName ?? session.email}. Within range.`,
        sourceKind: "form_response",
        sourceId: inserted[0].id,
        submittedBy: session.uid,
        payload: { slug, slot, out_of_range: check.outOfRangeLabels },
      });

      return { id: inserted[0].id, flagged, outOfRange: check.outOfRangeLabels };
    });

    if ("error" in result) {
      return NextResponse.json(result, { status: result.status });
    }

    // An out-of-range reading is the one event somebody needs to hear
    // about without opening the app. Wiring that to email needs a provider
    // key that isn't configured yet, so for now it lands in the audit log
    // above and in the runtime log, where it is at least visible.
    if (result.flagged) {
      console.warn(
        `[staff-logs] OUT OF RANGE org=${org} form=${slug} fields=${result.outOfRange.join("; ")}`
      );
    }

    return NextResponse.json({ ok: true, id: result.id, flagged: result.flagged });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    // This instance already has a live response — someone filed the same
    // form for the same shift, usually a double-tap or a second tab.
    if (message.includes("staff_responses_one_live")) {
      return NextResponse.json({ error: "already_submitted" }, { status: 409 });
    }
    // The read-only trigger. 402 rather than 403: this is about payment,
    // and the distinction matters to whoever reads the logs later.
    if (message.includes("read_only:")) {
      return NextResponse.json({ error: "read_only" }, { status: 402 });
    }
    console.error("[staff-logs] submit failed:", message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

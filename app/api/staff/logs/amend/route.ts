import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { enqueue, whoAndWhen } from "@/lib/staff/alerts";
import { loadTemplate } from "@/lib/staff/logs";
import { coerce, evaluate, type Answers } from "@/lib/staff/forms";
import { classify, isPlausible, type GeofenceMode, type OrgGeofence } from "@/lib/staff/geo";

// POST /api/staff/logs/amend
//
// A correction is an INSERT, never an UPDATE. staff.form_responses
// refuses UPDATE and DELETE outright — by grant and by trigger — so the
// only way a value can change is a new row pointing back at the one it
// replaces, carrying a written reason. Both rows live forever and both
// are in the hash chain.
//
// WHY THERE IS NO DRAFT STATE. The obvious version of this feature lets
// staff edit freely until they "send", which is an unrecorded editing
// window and therefore the exact hole the append-only work closed. A
// fridge that reads 55 and becomes 38.5 before anybody else sees it
// leaves no evidence 55 was ever observed, and that evidence is the
// product. So: amend whenever you like, and every version is kept.
//
// The three-minute alert hold is what makes that bearable in practice —
// a typo caught immediately retracts the alarm without retracting the
// record.

export const runtime = "nodejs";

const MIN_REASON = 20;
const MAX_REASON = 2000;
const MIN_CORRECTIVE = 20;

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  const { session, org } = auth.ctx;

  let body: {
    responseId?: string;
    answers?: Record<string, unknown>;
    reason?: string;
    correctiveAction?: string;
    location?: {
      lat?: unknown; lng?: unknown; accuracy?: unknown;
      denied?: unknown; note?: unknown;
    } | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const responseId = String(body.responseId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(responseId)) {
    return NextResponse.json({ error: "bad_response_id" }, { status: 400 });
  }

  const reason = String(body.reason ?? "").trim().slice(0, MAX_REASON);
  if (reason.length < MIN_REASON) {
    return NextResponse.json(
      { error: "reason_required", min: MIN_REASON },
      { status: 400 }
    );
  }

  const corrective = String(body.correctiveAction ?? "").trim();

  try {
    const result = await withSession(session, async (sql) => {
      // The row being amended, read inside the same transaction that will
      // write its replacement, and scoped to this org — RLS would refuse
      // another clinic's row anyway, but a 404 is a better answer than a
      // policy violation.
      const [orig] = await sql<
        { instance_id: string; template_slug: string; answers_json: Answers }[]
      >`
        select r.instance_id,
               t.slug as template_slug,
               r.answers_json
          from staff.form_responses r
          join staff.form_instances i on i.id = r.instance_id
          join staff.form_templates t on t.id = i.template_id
         where r.id = ${responseId} and r.org_slug = ${org}
      `;
      if (!orig) return { error: "no_such_response" as const, status: 404 };

      // THE TEMPLATE IS RE-READ AND THE RANGE CHECK RE-RUN, exactly as on
      // first submission. A client that decided its corrected value was
      // fine does not get to file a clean record of a second alarming
      // reading.
      const template = await loadTemplate(sql, orig.template_slug);
      if (!template) return { error: "no_such_form" as const, status: 404 };

      const answers: Answers = {};
      for (const field of template.schema.fields) {
        answers[field.id] = coerce(field, body.answers?.[field.id]);
      }

      const check = evaluate(template.schema, answers);
      if (check.missing.length > 0) {
        return { error: "incomplete" as const, status: 400, missing: check.missing };
      }

      const flagged = check.outOfRange.length > 0;
      if (flagged && corrective.length < MIN_CORRECTIVE) {
        return { error: "corrective_action_required" as const, status: 400 };
      }

      const [amender] = await sql<{ legal_name: string | null }[]>`
        select legal_name from staff.users where id = ${session.uid}
      `;

      // Where the person was standing when they made the correction —
      // its own fact, not copied from the original.
      const geoRow = (
        await sql<{
          latitude: number | null; longitude: number | null;
          geofence_radius_m: number; geofence_mode: GeofenceMode;
          timezone: string;
        }[]>`
          select latitude, longitude, geofence_radius_m, geofence_mode, timezone
            from staff.orgs where slug = ${org}
        `
      )[0];
      const geofence: OrgGeofence = {
        lat: geoRow?.latitude ?? null,
        lng: geoRow?.longitude ?? null,
        radiusM: geoRow?.geofence_radius_m ?? 150,
        mode: geoRow?.geofence_mode ?? "off",
      };
      const rawLoc = body.location ?? null;
      const fix =
        rawLoc && isPlausible(rawLoc.lat, rawLoc.lng)
          ? {
              lat: Number(rawLoc.lat),
              lng: Number(rawLoc.lng),
              accuracy:
                typeof rawLoc.accuracy === "number" && Number.isFinite(rawLoc.accuracy)
                  ? rawLoc.accuracy
                  : null,
            }
          : null;
      const place = classify(geofence, fix, rawLoc?.denied === true);
      const locNote = String(rawLoc?.note ?? "").trim();

      const [amended] = await sql<{ new_id: string; alarm_cancelled: boolean }[]>`
        select new_id, alarm_cancelled from staff.amend_response(
          ${org}, ${responseId}, ${session.uid},
          ${sql.json(answers)},
          ${reason}, ${flagged}, ${check.outOfRange},
          ${flagged ? corrective : null},
          ${fix?.lat ?? null}, ${fix?.lng ?? null}, ${fix?.accuracy ?? null},
          ${place.distanceM}, ${place.status},
          ${locNote.length >= MIN_CORRECTIVE ? locNote : null}
        )
      `;

      return {
        ok: true as const,
        id: amended.new_id,
        alarmCancelled: amended.alarm_cancelled,
        flagged,
        templateName: template.name,
        timezone: geoRow?.timezone ?? "UTC",
        amendedByName: amender?.legal_name ?? null,
      };
    });

    if ("error" in result) {
      return NextResponse.json(result, { status: result.status });
    }

    // A correction that is ITSELF out of range raises its own alarm — it
    // is a new alarming reading, not a retraction of one.
    //
    // And an amendment made after the hold expired tells the
    // administrator it happened. Not to police it: a correction is
    // exactly what a working compliance system should produce, and the
    // one thing worse than a late amendment is a staff member who
    // decides it is not worth the trouble and leaves the wrong number
    // standing.
    const stamp = whoAndWhen(
      result.amendedByName,
      session.email,
      result.timezone
    );

    if (result.flagged) {
      await withSession(session, (sql) =>
        enqueue(sql, {
          org,
          kind: "excursion",
          subject: `STILL OUT OF RANGE · ${stamp} · ${result.templateName} · ${org}`,
          body: `${result.templateName} was amended and the new reading is still outside its range. Reason given: ${reason}`,
          sourceKind: "form_response",
          sourceId: result.id,
          submittedBy: session.uid,
        })
      );
    } else if (!result.alarmCancelled) {
      await withSession(session, (sql) =>
        enqueue(sql, {
          org,
          kind: "log",
          subject: `Amended · ${stamp} · ${result.templateName} · ${org}`,
          body: `An entry was amended after its alert window. Reason given: ${reason}`,
          sourceKind: "form_response",
          sourceId: result.id,
          submittedBy: session.uid,
        })
      );
    }

    return NextResponse.json({
      ok: true,
      id: result.id,
      alarmCancelled: result.alarmCancelled,
    });
  } catch (err) {
    // The database refuses a fork, a short reason and an already-amended
    // row by name. Those are the user's answer, not a server fault.
    const message = err instanceof Error ? err.message : String(err);
    if (/already been amended/.test(message)) {
      return NextResponse.json({ error: "already_amended" }, { status: 409 });
    }
    if (/at least 20 characters/.test(message)) {
      return NextResponse.json({ error: "reason_required", min: MIN_REASON }, { status: 400 });
    }
    console.error("[amend] failed:", message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

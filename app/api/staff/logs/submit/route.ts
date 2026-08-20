import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { enqueue, whoAndWhen } from "@/lib/staff/alerts";
import { loadTemplate, ensureInstance } from "@/lib/staff/logs";
import { coerce, evaluate, type Answers } from "@/lib/staff/forms";
import {
  classify,
  isPlausible,
  type GeofenceMode,
  type OrgGeofence,
} from "@/lib/staff/geo";

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
    location?: {
      lat?: unknown;
      lng?: unknown;
      accuracy?: unknown;
      denied?: unknown;
      note?: unknown;
    } | null;
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

      // THE CLINIC'S OWN COORDINATES AND RULES, READ HERE. A client that
      // announced it was on site does not get to decide that — same
      // principle as re-running the range check server-side. The distance
      // stored is the one computed from this row.
      const [geoRow] = await sql<
        {
          latitude: number | null;
          longitude: number | null;
          geofence_radius_m: number;
          geofence_mode: GeofenceMode;
          timezone: string;
        }[]
      >`
        select latitude, longitude, geofence_radius_m, geofence_mode, timezone
          from staff.orgs where slug = ${org}
      `;
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
              lat: rawLoc.lat as number,
              lng: rawLoc.lng as number,
              accuracy:
                typeof rawLoc.accuracy === "number" &&
                Number.isFinite(rawLoc.accuracy)
                  ? rawLoc.accuracy
                  : null,
            }
          : null;
      const place = classify(geofence, fix, rawLoc?.denied === true);

      const locNote =
        typeof rawLoc?.note === "string" ? rawLoc.note.trim().slice(0, 2000) : "";

      // Enforced here as well as in the browser, because a request that
      // skips the form skips the form's validation with it.
      if (place.needsNote && locNote.length < MIN_CORRECTIVE) {
        return { error: "location_note_required" as const, status: 400 };
      }

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
           has_out_of_range, out_of_range_fields, corrective_action,
           filed_lat, filed_lng, filed_accuracy_m, filed_distance_m,
           location_status, location_note)
        values
          (${instanceId}, ${org}, ${session.uid}, ${sql.json(answers)},
           ${flagged ? "flagged" : "pending"}, ${flagged},
           ${check.outOfRange}, ${flagged ? corrective : null},
           ${fix?.lat ?? null}, ${fix?.lng ?? null}, ${fix?.accuracy ?? null},
           ${place.distanceM}, ${place.status},
           ${locNote.length >= MIN_CORRECTIVE ? locNote : null})
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
                ${sql.json({
                  slug,
                  slot,
                  out_of_range: check.outOfRangeLabels,
                  // Rounded to the metre. The audit trail is a record of
                  // what happened, not a coordinate log — the exact fix
                  // lives on the response row and nowhere else.
                  location: place.status,
                  distance_m:
                    place.distanceM === null ? null : Math.round(place.distanceM),
                })})
      `;

      // The alert is enqueued INSIDE this transaction, so an excursion
      // and the record of having raised it either both exist or neither
      // does. Sending happens later, from the cron sweep — emailing here
      // would make the mail provider's slow afternoon into this person's
      // slow submit button, and a provider outage into either a 500 on
      // an already-filed log or a silently lost excursion.
      const stamp = whoAndWhen(
        profileName ?? null,
        session.email,
        geoRow?.timezone ?? "UTC"
      );

      await enqueue(sql, {
        org,
        kind: flagged ? "excursion" : "log",
        // ORDERED FOR A LOCK SCREEN, which shows about forty characters.
        // Status, then who, then when, then what — because the first
        // three are what decide whether to open it, and the template
        // name is both the longest field and the least urgent. Leading
        // with the clinic slug and the template name pushed the staff
        // member's name off the end of every excursion subject, which
        // defeated the point of putting it there.
        subject: flagged
          ? `OUT OF RANGE · ${stamp} · ${template.name} · ${org}`
          : `Logged · ${stamp} · ${template.name} · ${org}`,
        body: flagged
          ? [
              `${template.name} (${slot.toUpperCase()}) is out of range.`,
              `Out of range: ${check.outOfRangeLabels.join(", ")}`,
              `Filed by ${stamp} (${geoRow?.timezone ?? "UTC"})`,
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

import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession, type StaffSql } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";

// POST /api/staff/obligations/:id — act on one obligation.
//
// Four actions, because they are four different claims about the world
// and they carry different permissions:
//
//   complete   — "this was done, here is what we did"
//   reopen     — "that completion was wrong, here is why"
//   assign     — "this is now yours"
//   reschedule — "the date moved"
//   retire     — "this doesn't apply to us"
//
// Completing is the one a regular staff member can do, and only for
// something assigned to them. The rest are the compliance calendar, which
// is a lead's job.

export const runtime = "nodejs";

const MAX_NOTE = 4000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolve();
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  const { session, org } = auth.ctx;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";

  try {
    const result = await withSession(session, async (sql) => {
      // RLS already restricts this to the caller's org, so a miss here is
      // genuinely "no such obligation" and not a leak of another org's
      // ids.
      const rows = await sql<
        { id: string; owner_id: string | null; completed_at: string | null; title: string }[]
      >`
        select id, owner_id, completed_at::text as completed_at, title
          from staff.obligations where id = ${id} and active
      `;
      const ob = rows[0];
      if (!ob) return { error: "not_found" as const, status: 404 };

      const isLead = atLeast(session.role, "clinical_lead");
      const isAdmin = atLeast(session.role, "manager");

      if (action === "complete") {
        // Anyone can complete what they own. Someone else's obligation
        // takes a lead — otherwise the register records the wrong person
        // as having done it and nobody notices until it matters.
        if (!isLead && ob.owner_id !== session.uid) {
          return { error: "not_yours" as const, status: 403 };
        }
        if (ob.completed_at) return { error: "already_done" as const, status: 409 };

        const evidence = trim(body.evidence, MAX_NOTE);
        // Mirrors the CHECK constraint. Reaching the constraint would
        // stop it too, but a 400 that names the problem beats a 500.
        if (evidence.length < 3) {
          return { error: "evidence_required" as const, status: 400 };
        }

        await sql`
          update staff.obligations
             set completed_at = now(),
                 completed_by = ${session.uid},
                 evidence_note = ${evidence}
           where id = ${id}
        `;
        await audit(sql, org, session.uid, "obligation_completed", id, {
          title: ob.title,
        });
        return { ok: true as const };
      }

      if (action === "reopen") {
        if (!isLead) return { error: "forbidden" as const, status: 403 };
        if (!ob.completed_at) return { error: "not_completed" as const, status: 409 };

        const reason = trim(body.reason, MAX_NOTE);
        if (reason.length < 3) {
          return { error: "reason_required" as const, status: 400 };
        }

        // completed_by and evidence_note are cleared by the trigger,
        // which also files the displaced completion into history. Doing
        // it there rather than here means a reopen from psql keeps the
        // record too.
        await sql`
          update staff.obligations
             set completed_at = null, reopen_reason = ${reason}
           where id = ${id}
        `;
        await audit(sql, org, session.uid, "obligation_reopened", id, {
          title: ob.title,
          reason,
        });
        return { ok: true as const };
      }

      if (action === "assign") {
        if (!isLead) return { error: "forbidden" as const, status: 403 };
        const ownerId = trim(body.ownerId, 64) || null;
        if (ownerId) {
          const owner = await sql<{ id: string }[]>`
            select id from staff.users where id = ${ownerId} and active
          `;
          if (owner.length === 0) return { error: "no_such_owner" as const, status: 400 };
        }
        await sql`update staff.obligations set owner_id = ${ownerId} where id = ${id}`;
        await audit(sql, org, session.uid, "obligation_assigned", id, {
          title: ob.title,
          owner_id: ownerId,
        });
        return { ok: true as const };
      }

      if (action === "reschedule") {
        if (!isLead) return { error: "forbidden" as const, status: 403 };
        // Mirrors the trigger. A completed obligation's due date is the
        // half of the record that says whether it was done on time.
        if (ob.completed_at) return { error: "already_done" as const, status: 409 };
        const dueOn = trim(body.dueOn, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
          return { error: "bad_due_date" as const, status: 400 };
        }
        await sql`update staff.obligations set due_on = ${dueOn}::date where id = ${id}`;
        // Moving a deadline is the action most worth being able to
        // reconstruct later, so the old date goes in the audit entry.
        await audit(sql, org, session.uid, "obligation_rescheduled", id, {
          title: ob.title,
          due_on: dueOn,
        });
        return { ok: true as const };
      }

      if (action === "retire") {
        if (!isAdmin) return { error: "forbidden" as const, status: 403 };
        const reason = trim(body.reason, MAX_NOTE);
        if (reason.length < 3) return { error: "reason_required" as const, status: 400 };
        // Deactivated, not deleted: the register keeps the fact that
        // somebody decided this one didn't apply, and who.
        await sql`update staff.obligations set active = false where id = ${id}`;
        await audit(sql, org, session.uid, "obligation_retired", id, {
          title: ob.title,
          reason,
        });
        return { ok: true as const };
      }

      return { error: "bad_action" as const, status: 400 };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    if (message.includes("reopen_reason required")) {
      return NextResponse.json({ error: "reason_required" }, { status: 400 });
    }
    if (
      message.includes("a recorded completion cannot be edited") ||
      message.includes("the due date of a completed obligation cannot be moved")
    ) {
      return NextResponse.json({ error: "completion_immutable" }, { status: 409 });
    }
    console.error("[staff-obligations] action failed:", message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

function trim(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function audit(
  sql: StaffSql,
  org: string,
  actor: string,
  action: string,
  entityId: string,
  detail: Record<string, string | null>
) {
  await sql`
    insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
    values (${org}, ${actor}, ${action}, 'obligation', ${entityId}, ${sql.json(detail)})
  `;
}

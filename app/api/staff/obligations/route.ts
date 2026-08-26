import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";

// POST /api/staff/obligations — add one obligation.
//
// The seeded register covers what every urgent care owes. This is for
// everything else: an accreditation finding with a correction date, a
// franchise bulletin with a deadline, a state rule that only applies
// here. Those are the ones that get lost, because they arrive once, by
// email, addressed to nobody in particular.
//
// Not gated by read-only. See the header of supabase/staff-obligations.sql:
// a lapsed card stops the daily log workflow, not a clinic's ability to
// write down a regulatory deadline.

export const runtime = "nodejs";

const MAX_TITLE = 200;
const MAX_DETAIL = 4000;

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  const { session, org } = auth.ctx;

  // Adding an obligation commits the whole organization to a deadline and
  // puts somebody's name against it. Administrators only.
  if (!atLeast(session.role, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const title = str(body.title, MAX_TITLE);
  const dueOn = str(body.dueOn, 10);
  if (!title) return NextResponse.json({ error: "missing_title" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
    return NextResponse.json({ error: "bad_due_date" }, { status: 400 });
  }

  const repeat = Number(body.repeatMonths);
  const repeatMonths =
    Number.isInteger(repeat) && repeat >= 1 && repeat <= 60 ? repeat : null;

  const ownerId = str(body.ownerId, 64) || null;

  try {
    const result = await withSession(session, async (sql) => {
      // An owner from another org would be silently dropped by RLS on the
      // join and show as unowned; refusing outright says what happened.
      if (ownerId) {
        const owner = await sql<{ id: string }[]>`
          select id from staff.users where id = ${ownerId} and active
        `;
        if (owner.length === 0) return { error: "no_such_owner" as const, status: 400 };
      }

      const rows = await sql<{ id: string }[]>`
        insert into staff.obligations
          (org_slug, title, detail, category, citation, source,
           due_on, owner_id, repeat_months, created_by)
        values
          (${org}, ${title}, ${str(body.detail, MAX_DETAIL) || null},
           ${str(body.category, 40) || null}, ${str(body.citation, 200) || null},
           ${str(body.source, 200) || "Added by an administrator"},
           ${dueOn}::date, ${ownerId}, ${repeatMonths}, ${session.uid})
        returning id
      `;

      await sql`
        insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
        values (${org}, ${session.uid}, 'obligation_created', 'obligation',
                ${rows[0].id}, ${sql.json({ title, due_on: dueOn })})
      `;

      return { id: rows[0].id };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, id: result.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    console.error("[staff-obligations] create failed:", message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

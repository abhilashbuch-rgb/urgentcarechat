import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";

// POST /api/staff/roster — record one exclusion screen.
//
// Append-only by grant: staff_app holds SELECT and INSERT on
// staff.exclusion_checks and nothing else. A screening record states what
// was known on a date, so correcting one means recording a new screen
// rather than editing the old one into a different answer.

export const runtime = "nodejs";

const SOURCES = new Set(["oig_leie", "sam_gov"]);
const RESULTS = new Set(["clear", "possible_match", "excluded"]);

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const userId = typeof body.userId === "string" ? body.userId : "";
  const source = typeof body.source === "string" ? body.source : "";
  const result = typeof body.result === "string" ? body.result : "";
  const detail = (typeof body.detail === "string" ? body.detail : "").trim().slice(0, 2000);

  if (!userId || !SOURCES.has(source) || !RESULTS.has(result)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  // Mirrors the CHECK constraint. Reaching the constraint would stop it
  // too, but a 400 that names the problem beats a 500.
  if (result !== "clear" && detail.length < 3) {
    return NextResponse.json({ error: "detail_required" }, { status: 400 });
  }

  try {
    const out = await withSession(session, async (sql) => {
      const person = await sql<{ id: string }[]>`
        select id from staff.users where id = ${userId} and active
      `;
      if (person.length === 0) return { error: "no_such_person" as const, status: 404 };

      await sql`
        insert into staff.exclusion_checks
          (org_slug, user_id, source, result, detail, checked_by)
        values
          (${org}, ${userId}, ${source}::staff.exclusion_source,
           ${result}::staff.exclusion_result,
           ${result === "clear" ? null : detail}, ${session.uid})
      `;
      await sql`
        insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
        values (${org}, ${session.uid}, 'exclusion_screened', 'user', ${userId},
                ${sql.json({ source, result })})
      `;
      return { ok: true as const };
    });

    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = err instanceof Error ? err.message : "Unknown";
    if (m.includes("staff_exclusion_needs_detail")) {
      return NextResponse.json({ error: "detail_required" }, { status: 400 });
    }
    console.error("[staff-roster] screen failed:", m);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

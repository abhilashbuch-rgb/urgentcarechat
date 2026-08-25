import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/notifications — the one email preference somebody sets
// for themselves.
//
// SELF ONLY. An administrator manages this for someone else from
// /staff/team/[id] instead (same column, same audit trail, different
// actor). Urgent alerts have no toggle here or there — see
// supabase/staff-alerts.sql.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  const form = await req.formData();
  const wants = String(form.get("wants") ?? "") === "1";

  await withSession(session, async (sql) => {
    await sql`
      update staff.users set wants_digest = ${wants} where id = ${session.uid}
    `;
    await sql`
      insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
      values (${org}, ${session.uid}, 'digest_preference_changed', 'user', ${session.uid},
              ${sql.json({ wants_digest: wants })})
    `;
  });

  return redirectAfterPost("/staff/me?done=digest_updated");
}

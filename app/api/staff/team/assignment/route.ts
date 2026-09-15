import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { createAssignment, deleteAssignment } from "@/lib/staff/shift-assignments";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/team/assignment — assign or remove one name to one
// job on one date. See the header of supabase/staff-shift-assignments.sql
// for why this is a per-date entry rather than a recurring pattern or a
// standing placeholder profile.
//
// Manager-and-up only, same gate as everything else on the Team screen
// this posts back to (app/staff/team/page.tsx).

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "manager")) {
    return redirectAfterPost("/staff/team?e=forbidden");
  }

  const form = await req.formData();
  const action = String(form.get("action") ?? "");

  try {
    await withSession(session, async (sql) => {
      if (action === "add") {
        const workDate = String(form.get("work_date") ?? "");
        const jobRole = String(form.get("job_role") ?? "");
        const name = String(form.get("name") ?? "").trim().slice(0, 200);
        if (!workDate || !jobRole || !name) return;

        await createAssignment(sql, org, session.uid, workDate, jobRole, name);
        await sql`
          insert into staff.audit_log (org_slug, actor_id, action, entity, detail)
          values (${org}, ${session.uid}, 'shift_assignment_added', 'shift_assignment',
                  ${sql.json({ work_date: workDate, job_role: jobRole, name })})
        `;
        return;
      }

      if (action === "delete") {
        const id = String(form.get("id") ?? "");
        if (!id) return;

        await deleteAssignment(sql, id);
        await sql`
          insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id)
          values (${org}, ${session.uid}, 'shift_assignment_removed', 'shift_assignment', ${id})
        `;
      }
    });
  } catch (err) {
    console.error(
      "[staff-team-assignment] action failed:",
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/team?e=server_error");
  }

  return redirectAfterPost("/staff/team?done=assignment_saved");
}

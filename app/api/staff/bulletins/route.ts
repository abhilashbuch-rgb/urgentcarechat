import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { runsClinic } from "@/lib/staff/roles";
import { postBulletin, deleteBulletin } from "@/lib/staff/bulletins";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/bulletins — post or remove a clinic notice.
//
// Gated the same way as which logs this clinic runs: owner or manager by
// ROLE, or the centre admin by JOB — see runsClinic(). Not a broader
// "administrator" check, because the centre admin is very often the
// person who actually knows the fridge is getting serviced Thursday, and
// their account role is usually plain "staff".
//
// A plain form POST, one action per submit, same reason as everywhere
// else in this schema: it works from a phone on the floor and the
// navigation is the feedback.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  const form = await req.formData();
  const action = String(form.get("action") ?? "");

  try {
    const allowed = await withSession(session, async (sql) => {
      const me = await getProfile(sql, session.uid);
      if (!runsClinic(session.role, me?.job_role ?? null)) return false;

      if (action === "post") {
        const body = String(form.get("body") ?? "").trim().slice(0, 500);
        if (body.length < 2) return true;

        await postBulletin(sql, org, session.uid, body);
        await sql`
          insert into staff.audit_log (org_slug, actor_id, action, entity, detail)
          values (${org}, ${session.uid}, 'bulletin_posted', 'bulletin', ${sql.json({ body })})
        `;
        return true;
      }

      if (action === "delete") {
        const id = String(form.get("id") ?? "");
        if (!id) return true;

        await deleteBulletin(sql, id);
        await sql`
          insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id)
          values (${org}, ${session.uid}, 'bulletin_deleted', 'bulletin', ${id})
        `;
        return true;
      }

      return true;
    });

    if (!allowed) return redirectAfterPost("/staff?e=forbidden");
  } catch (err) {
    console.error(
      "[staff-bulletins] action failed:",
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff?e=save");
  }

  return redirectAfterPost("/staff");
}

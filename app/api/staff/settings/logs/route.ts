import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { runsClinic } from "@/lib/staff/roles";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/settings/logs — which optional logs this clinic runs.
//
// Owner by ROLE or centre admin by JOB — see runsClinic(). The centre
// admin is the person who knows whether there is an autoclave in the
// back room, and their account role is usually plain "staff".
//
// A plain form POST like the rest of the admin controls, so it works on
// a phone in a corridor and the navigation is the feedback.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  const form = await req.formData();

  try {
    const allowed = await withSession(session, async (sql) => {
      const me = await getProfile(sql, session.uid);
      if (!runsClinic(session.role, me?.job_role ?? null)) return false;

      // AN UNCHECKED BOX IS NOT SUBMITTED AT ALL, so "off" cannot be read
      // off the form — the set of switchable logs has to come from the
      // database and each one compared against whether its box arrived.
      // Reading the list out of the request instead would let a crafted
      // POST name any slug it liked. set_log_enabled() refuses a
      // non-optional template anyway, so that would fail closed, but the
      // list belongs on the server regardless.
      const switchable = await sql<{ slug: string; active: boolean }[]>`
        select slug, active from staff.optional_logs
      `;
      for (const log of switchable) {
        const wanted = form.get(`log_${log.slug}`) !== null;
        if (wanted !== log.active) {
          // The org comes from the session, never from the form. The
          // function takes it as an argument and, running as definer,
          // does not check it.
          await sql`select staff.set_log_enabled(${org}, ${log.slug}, ${wanted})`;
        }
      }
      return true;
    });

    if (!allowed) return redirectAfterPost("/staff?e=forbidden");
  } catch (err) {
    console.error(
      "[staff-settings-logs] save failed for org",
      org,
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/settings/logs?e=save");
  }

  return redirectAfterPost("/staff/settings/logs?saved=1");
}

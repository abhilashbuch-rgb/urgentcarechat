import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/team/user — the administrative controls over one person.
//
// Two actions, both of which need to be instant rather than eventual:
//
//   deactivate — the kill switch. Sets active = false, which a trigger on
//     staff.users turns into a bumped session_epoch, which every live
//     session of theirs fails on its next request. Not "at next sign-in":
//     the session in their pocket stops working while they are holding it.
//
//   reset_mfa — clears a second factor for someone who lost their phone.
//     Also revokes their sessions, because a factor being reset is
//     precisely the moment you want any session that predates it gone.
//
// A plain form POST rather than fetch: this has to work on a phone with a
// flaky connection, and a form that navigates gives unambiguous feedback
// about whether it happened.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  // Checked here and not only by hiding the buttons. The nav is a
  // convenience; this is the control.
  if (!atLeast(session.role, "manager")) {
    return redirectAfterPost("/staff?e=forbidden");
  }

  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  const userId = String(form.get("user_id") ?? "");
  if (!userId) return redirectAfterPost("/staff/team?e=bad_request");

  // Deactivating yourself locks you out of the screen you would need to
  // undo it, and if you are the only admin it locks the whole
  // organization out. Refused rather than confirmed — there is no version
  // of this that is what someone meant to do.
  if (userId === session.uid && action === "deactivate") {
    return redirectAfterPost("/staff/team?e=not_yourself");
  }

  try {
    const outcome = await withSession(session, async (sql) => {
      // RLS already confines this to the caller's org; the explicit
      // org_slug here is so a wrong id fails as not-found rather than
      // silently matching nothing.
      const target = await sql<{ id: string; role: string; active: boolean }[]>`
        select id, role, active from staff.users
         where id = ${userId} and org_slug = ${org}
      `;
      if (target.length === 0) return { error: "not_found" as const };

      // A MANAGER OVERSEES STAFF, NOT THE OWNER. Every action below —
      // deactivate, reset a factor, sign someone out, touch their digest
      // preference — reaches an org_admin or platform_super_admin account
      // only when the actor is one too. Without this a manager account
      // could lock the actual owner out of their own clinic.
      if (
        !atLeast(session.role, "org_admin") &&
        (target[0].role === "org_admin" || target[0].role === "platform_super_admin")
      ) {
        return { error: "not_permitted" as const };
      }

      if (action === "deactivate" || action === "activate") {
        const nextActive = action === "activate";

        // Never leave an org with no way back in. Counted inside the same
        // transaction as the update so two admins deactivating each other
        // at once cannot both succeed.
        if (!nextActive) {
          const admins = await sql<{ count: string }[]>`
            select count(*)::text as count from staff.users
             where org_slug = ${org} and active
               and role in ('org_admin','platform_super_admin')
               and id <> ${userId}
          `;
          if (Number(admins[0].count) === 0) return { error: "last_admin" as const };
        }

        await sql`
          update staff.users set active = ${nextActive} where id = ${userId}
        `;
        // Reactivating does not restore old sessions — the epoch bumped
        // when they were switched off and stays bumped. They sign in again.
        await sql`
          insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id)
          values (${org}, ${session.uid},
                  ${nextActive ? "user_activated" : "user_deactivated"},
                  'user', ${userId})
        `;
        return { ok: nextActive ? "activated" : "deactivated" };
      }

      if (action === "reset_mfa") {
        await sql`
          update staff.users
             set totp_secret = null,
                 totp_confirmed_at = null,
                 totp_last_step = null,
                 session_epoch = session_epoch + 1
           where id = ${userId}
        `;
        await sql`
          insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id)
          values (${org}, ${session.uid}, 'mfa_reset', 'user', ${userId})
        `;
        return { ok: "mfa_reset" };
      }

      if (action === "revoke_sessions") {
        await sql`
          update staff.users set session_epoch = session_epoch + 1 where id = ${userId}
        `;
        await sql`
          insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id)
          values (${org}, ${session.uid}, 'sessions_revoked', 'user', ${userId})
        `;
        return { ok: "sessions_revoked" };
      }

      // The one preference an administrator can set on somebody else's
      // behalf. Deliberately just this one: urgent alerts have no column
      // to disable at all (see supabase/staff-alerts.sql), so there is
      // nothing else here to toggle.
      if (action === "toggle_digest") {
        const wants = String(form.get("wants") ?? "") === "1";
        await sql`
          update staff.users set wants_digest = ${wants} where id = ${userId}
        `;
        await sql`
          insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
          values (${org}, ${session.uid}, 'digest_preference_changed', 'user', ${userId},
                  ${sql.json({ wants_digest: wants })})
        `;
        return { ok: "digest_updated" as const };
      }

      return { error: "bad_action" as const };
    });

    if ("error" in outcome) {
      return redirectAfterPost(`/staff/team?e=${outcome.error}`);
    }
    if (outcome.ok === "digest_updated") {
      return redirectAfterPost(`/staff/team/${userId}?done=digest_updated`);
    }
    return redirectAfterPost(`/staff/team?done=${outcome.ok}`);
  } catch (err) {
    console.error(
      "[staff-team] action failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return redirectAfterPost("/staff/team?e=server_error");
  }
}

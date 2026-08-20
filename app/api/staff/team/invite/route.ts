import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { redirectAfterPost } from "@/lib/staff/http";
import { issue, revoke, type InviteRole } from "@/lib/staff/invites";

// POST /api/staff/team/invite — the administrator's control over who may
// come in at all.
//
// Two actions: send an invitation, and revoke a pending one. Both are
// plain form POSTs for the same reason as the rest of the Team screen —
// this has to work on a phone in a corridor, and a navigation is
// unambiguous about whether it happened.
//
// THE ROLE IS CHOSEN BY THE ADMINISTRATOR, NEVER BY THE INVITEE. The
// job role travels with the invitation for the same reason: a new hire
// confirming "I am an X-ray tech" on their first morning is the one
// moment nobody is watching.

export const runtime = "nodejs";

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s);

// Mirrors staff.user_role. Anything else is refused rather than
// defaulted: silently downgrading a mistyped 'admin' to staff would look
// like it worked and leave the clinic without an administrator.
const ROLES = new Set<InviteRole>(["staff", "org_admin"]);

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "org_admin")) {
    return redirectAfterPost("/staff?e=forbidden");
  }

  const form = await req.formData();
  const action = String(form.get("action") ?? "");

  if (action === "revoke") {
    const id = String(form.get("invite_id") ?? "");
    if (!id) return redirectAfterPost("/staff/team?e=bad_request");
    await withSession(session, (sql) => revoke(sql, org, id));
    return redirectAfterPost("/staff/team?done=revoked");
  }

  if (action !== "invite") {
    return redirectAfterPost("/staff/team?e=bad_request");
  }

  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 160);
  const roleRaw = String(form.get("role") ?? "staff") as InviteRole;
  const jobRole = String(form.get("job_role") ?? "").trim().slice(0, 40) || null;

  if (!isEmail(email)) return redirectAfterPost("/staff/team?e=bad_email");
  if (!ROLES.has(roleRaw)) return redirectAfterPost("/staff/team?e=bad_role");

  try {
    const result = await withSession(session, (sql) =>
      issue(sql, org, session.uid, email, roleRaw, jobRole)
    );

    if (!result.ok) return redirectAfterPost(`/staff/team?e=${result.reason}`);

    // "Sent" and "created but not sent" are different outcomes and the
    // screen says which. An administrator who is told an invitation was
    // emailed will not follow up when it never arrives.
    return redirectAfterPost(
      result.mailed ? "/staff/team?done=invited" : "/staff/team?done=invited_no_mail"
    );
  } catch (err) {
    console.error("[invite] failed:", err);
    return redirectAfterPost("/staff/team?e=invite_failed");
  }
}

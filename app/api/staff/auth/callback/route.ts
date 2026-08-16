import { NextRequest } from "next/server";
import { callbackUrl, exchangeCode } from "@/lib/staff/google";
import { isLocalRequest, redirectTo } from "@/lib/staff/http";
import { withOrg } from "@/lib/staff/db";
import {
  signSession,
  STAFF_COOKIE,
  STAFF_COOKIE_MAX_AGE,
  type StaffRole,
} from "@/lib/staff/session";

// GET /api/staff/auth/callback — Google redirects here with a code.
//
// This is where authorization happens. Google told us *who* someone is;
// staff.org_invites decides whether that person may be here at all. An
// email with no matching invite is turned away — it does not get an
// account created for it "pending approval", because a row in staff.users
// is the thing every other policy keys off.

export const runtime = "nodejs";

interface UserRow {
  id: string;
  role: StaffRole;
  active: boolean;
  name: string | null;
  session_epoch: number;
  mfa_enrolled: boolean;
}

interface InviteRow {
  role: StaffRole;
}

function deny(reason: string) {
  return redirectTo(`/staff/signin?e=${reason}`);
}

export async function GET(req: NextRequest) {
  const org = req.headers.get("x-tenant-slug");
  if (!org) return deny("no_org");

  const params = req.nextUrl.searchParams;

  // The user pressed "Cancel" on Google's screen, or Google refused.
  if (params.get("error")) return deny("cancelled");

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = req.cookies.get("uc_staff_state")?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return deny("bad_state");
  }

  const identity = await exchangeCode(code, callbackUrl(req));
  if (!identity) return deny("exchange_failed");

  // An unverified Google address can be one someone merely claims to own.
  if (!identity.emailVerified) return deny("unverified_email");

  const emailDomain = identity.email.split("@")[1] ?? "";

  let outcome:
    | { user: UserRow; mfaRequired: boolean }
    | { denied: "no_invite" | "deactivated" | "wrong_domain" };
  try {
    // Every statement below runs with the org context of the HOSTNAME —
    // there is no session yet, so the host is the only trustworthy source
    // of "which org". RLS therefore confines the whole sign-in to this org
    // even if a query below were written carelessly.
    outcome = await withOrg(org, "staff", async (sql) => {
      const orgs = await sql<
        { google_hosted_domain: string | null; mfa_required_roles: StaffRole[] }[]
      >`
        select google_hosted_domain, mfa_required_roles
          from staff.orgs where slug = ${org}
      `;
      const policy = orgs[0];

      // Checked BEFORE the invite lookup, and before any row is touched.
      // An org that has bound itself to a Workspace domain is saying that
      // no account outside it is theirs — including one that matches an
      // invite, because a personal address on an invite is exactly the
      // mistake this catches.
      if (
        policy?.google_hosted_domain &&
        identity.hostedDomain !== policy.google_hosted_domain.toLowerCase()
      ) {
        await sql`
          insert into staff.audit_log (org_slug, action, entity, detail)
          values (${org}, 'signin_denied', 'email', ${sql.json({
            email: identity.email,
            reason: "wrong_domain",
            presented: identity.hostedDomain,
          })})
        `;
        return { denied: "wrong_domain" as const };
      }

      const mfaRoles = policy?.mfa_required_roles ?? [];

      const existing = await sql<UserRow[]>`
        select id, role, active, name, session_epoch,
               (totp_confirmed_at is not null) as mfa_enrolled
          from staff.users
         where org_slug = ${org}
           and (google_sub = ${identity.sub} or lower(email) = ${identity.email})
         limit 1
      `;

      if (existing.length > 0) {
        const user = existing[0];
        // Deactivated, not uninvited. Telling a former employee to "ask
        // for an invite" sends them to their old manager for something
        // that was switched off on purpose.
        if (!user.active) return { denied: "deactivated" as const };

        // First sign-in for someone created by email: bind the Google
        // subject now, so a later address change doesn't orphan them.
        await sql`
          update staff.users
             set google_sub   = ${identity.sub},
                 name         = coalesce(${identity.name}, name),
                 last_seen_at = now()
           where id = ${user.id}
        `;
        return { user, mfaRequired: mfaRoles.includes(user.role) };
      }

      const invite = await sql<InviteRow[]>`
        select role
          from staff.org_invites
         where org_slug = ${org}
           and revoked_at is null
           and (lower(email) = ${identity.email}
                or lower(email_domain) = ${emailDomain})
         -- An invite addressed to this person beats a blanket domain
         -- invite, so a named org_admin isn't demoted to the domain's
         -- default role.
         order by (email is not null) desc
         limit 1
      `;

      if (invite.length === 0) {
        await sql`
          insert into staff.audit_log (org_slug, action, entity, detail)
          values (${org}, 'signin_denied', 'email', ${sql.json({
            email: identity.email,
            reason: "no_invite",
          })})
        `;
        return { denied: "no_invite" as const };
      }

      const created = await sql<UserRow[]>`
        insert into staff.users (google_sub, email, name, org_slug, role)
        values (${identity.sub}, ${identity.email}, ${identity.name},
                ${org}, ${invite[0].role}::staff.user_role)
        returning id, role, active, name, session_epoch,
                  (totp_confirmed_at is not null) as mfa_enrolled
      `;
      return {
        user: created[0],
        mfaRequired: mfaRoles.includes(created[0].role),
      };
    });
  } catch (err) {
    console.error(
      "[staff-auth] sign-in failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return deny("server_error");
  }

  if ("denied" in outcome) return deny(outcome.denied);

  const { user, mfaRequired } = outcome;

  await withOrg(org, user.role, async (sql) => {
    await sql`
      insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id)
      values (${org}, ${user.id}, 'signin', 'user', ${user.id})
    `;
  }).catch(() => {
    // An audit write that fails must not strand someone at a sign-in
    // screen that keeps "working" when they retry. The failure is logged
    // by postgres; the sign-in proceeds.
  });

  // A session that still owes a second factor is minted as "pending": it
  // proves who you are and unlocks nothing but the MFA screens.
  const token = await signSession({
    uid: user.id,
    org: user.role === "platform_super_admin" ? null : org,
    role: user.role,
    email: identity.email,
    name: user.name ?? identity.name,
    ep: user.session_epoch,
    mfa: mfaRequired ? "pending" : "ok",
  });

  const res = redirectTo(
    !mfaRequired ? "/staff" : user.mfa_enrolled ? "/staff/mfa" : "/staff/mfa/enroll"
  );
  res.cookies.set(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: !isLocalRequest(req),
    sameSite: "lax",
    // Path "/" because the cookie has to reach both the /staff pages and
    // the /api/staff handlers, and a cookie can only carry one path. The
    // separation that matters isn't the path: the patient-triage routes
    // read no cookies at all and import nothing from lib/staff.
    path: "/",
    maxAge: STAFF_COOKIE_MAX_AGE,
  });
  res.cookies.set("uc_staff_state", "", { path: "/api/staff/auth", maxAge: 0 });
  return res;
}

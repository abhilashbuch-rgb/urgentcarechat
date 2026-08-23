import { NextRequest } from "next/server";
import { callbackUrl, exchangeCode } from "@/lib/staff/google";
import { isLocalRequest, redirectTo } from "@/lib/staff/http";
import { withOrg } from "@/lib/staff/db";
import { onboardingState, stepFor } from "@/lib/staff/onboarding";
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
//
// ONE CALLBACK URL FOR EVERY CUSTOMER. This used to run per-subdomain,
// which meant a Google redirect URI registered by hand for each one. The
// cost of that convenience is that this handler does not know which org
// the person belongs to when it starts — the hostname no longer says. It
// asks the database, through the two narrow SECURITY DEFINER functions in
// staff-single-domain.sql, and refuses rather than guessing if the answer
// is ambiguous.

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
  /** The clinic job the inviter assigned. Null on an older invite, and
   *  on a domain-wide one where the inviter cannot know who will use it. */
  job_role: string | null;
  /** Optional pre-fill, confirmed in the wizard before it is signed with. */
  legal_name: string | null;
}

function deny(reason: string) {
  return redirectTo(`/staff/signin?e=${reason}`);
}

export async function GET(req: NextRequest) {
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

  let outcome:
    | { user: UserRow; mfaRequired: boolean; needsOnboarding: boolean }
    | { denied: "no_invite" | "deactivated" | "wrong_domain" | "ambiguous" };
  let org = "";
  try {
    // Which org, before any org context exists. Deliberately the only
    // cross-org read in the system, and it happens exactly once per
    // sign-in — everything after this line is scoped to the answer.
    const found = await withOrg("", "staff", async (sql) => {
      const member = await sql<{ org_slug: string }[]>`
        select org_slug from staff.resolve_signin(${identity.email}, ${identity.sub})
      `;
      if (member.length === 1) return { org: member[0].org_slug };
      // Two rows means the same person exists in two orgs. That is a
      // real situation this build has no screen for, and picking one for
      // them would put someone in the wrong clinic's records.
      if (member.length > 1) return { ambiguous: true as const };

      const invite = await sql<{ org_slug: string }[]>`
        select org_slug from staff.resolve_invite(${identity.email})
      `;
      if (invite.length === 1) return { org: invite[0].org_slug };
      if (invite.length > 1) return { ambiguous: true as const };
      return { none: true as const };
    });

    if ("ambiguous" in found) return deny("ambiguous");
    if ("none" in found) return deny("no_invite");
    org = found.org;

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
        // Deferred, not skipped: someone still mid-onboarding has no
        // authenticator app yet, so MFA for this role waits until the
        // wizard's last step actually finishes (see the "orientation"
        // action in /api/staff/onboarding).
        const state = await onboardingState(sql, user.id);
        const needsOnboarding = !state || stepFor(state) !== "done";
        return {
          user,
          mfaRequired: mfaRoles.includes(user.role),
          needsOnboarding,
        };
      }

      // Scoped normally now that the org is known. The role still comes
      // from the invite rather than the resolver, so an invite revoked
      // between the two reads correctly denies here.
      const invite = await sql<InviteRow[]>`
        select role, job_role::text as job_role, legal_name
          from staff.org_invites
         where org_slug = ${org}
           and revoked_at is null
           and (lower(email) = ${identity.email}
                or lower(email_domain) = ${identity.email.split("@")[1] ?? ""})
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

      // The clinic job comes off the invite too, so a new hire lands on
      // a board that already has their work on it. Without this,
      // job_role stayed null until an administrator set it by hand and
      // the first screen a new person saw was an almost-empty board —
      // strict separation working correctly and looking broken.
      //
      // legal_name is pre-filled only if the inviter supplied one. It is
      // still confirmed in the wizard before anything is signed with it:
      // Google's display name is frequently not the name that belongs on
      // a signed record.
      const created = await sql<UserRow[]>`
        insert into staff.users
          (google_sub, email, name, org_slug, role, job_role, legal_name)
        values (${identity.sub}, ${identity.email}, ${identity.name},
                ${org}, ${invite[0].role}::staff.user_role,
                ${invite[0].job_role ?? null}::staff.job_role,
                ${invite[0].legal_name ?? null})
        returning id, role, active, name, session_epoch,
                  (totp_confirmed_at is not null) as mfa_enrolled
      `;
      const state = await onboardingState(sql, created[0].id);
      const needsOnboarding = !state || stepFor(state) !== "done";
      return {
        user: created[0],
        mfaRequired: mfaRoles.includes(created[0].role),
        needsOnboarding,
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

  const { user, mfaRequired, needsOnboarding } = outcome;

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
  // proves who you are and unlocks nothing but the MFA screens. That's
  // deferred while onboarding is still open — see needsOnboarding above.
  const mfaPending = mfaRequired && !needsOnboarding;
  const token = await signSession({
    uid: user.id,
    org: user.role === "platform_super_admin" ? null : org,
    role: user.role,
    email: identity.email,
    name: user.name ?? identity.name,
    ep: user.session_epoch,
    mfa: mfaPending ? "pending" : "ok",
  });

  const res = redirectTo(
    needsOnboarding
      ? "/staff/onboarding"
      : !mfaRequired
        ? "/staff"
        : user.mfa_enrolled
          ? "/staff/mfa"
          : "/staff/mfa/enroll"
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

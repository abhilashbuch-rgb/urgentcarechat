import { NextRequest } from "next/server";
import { withOrg } from "@/lib/staff/db";
import { onboardingState, stepFor } from "@/lib/staff/onboarding";
import {
  signSession,
  STAFF_COOKIE,
  STAFF_COOKIE_MAX_AGE,
  type StaffRole,
} from "@/lib/staff/session";
import { ORG_CHOICE_COOKIE, verifyOrgChoice } from "@/lib/staff/org-choice";
import { isLocalRequest, redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/auth/choose-clinic — the second half of the sign-in a
// linked, multi-clinic account needed a screen for. See
// app/staff/choose-clinic/page.tsx and supabase/staff-multisite-worker.sql.
//
// THE COOKIE PROVED WHO; THIS PROVES WHICH. A plain form POST, same as
// every other action on this screen's siblings — this has to work from a
// phone that just finished typing a six-digit code, and a navigation is
// unambiguous about whether it happened.
//
// THE SUBMITTED ORG IS NOT TRUSTED. It is re-checked against
// staff.list_my_orgs_for_person() using the person_key the cookie
// already proved, so a tampered form value cannot pick a clinic this
// person was never linked into.

export const runtime = "nodejs";

function deny(reason: string) {
  return redirectAfterPost(`/staff/signin?e=${reason}`);
}

interface FoundUser {
  id: string;
  role: StaffRole;
  active: boolean;
  name: string | null;
  session_epoch: number;
  mfa_enrolled: boolean;
}

type Outcome =
  | { denied: "choice_expired" | "deactivated" }
  | { user: FoundUser; mfaRequired: boolean; needsOnboarding: boolean };

export async function POST(req: NextRequest) {
  const jar = req.cookies;
  const choice = await verifyOrgChoice(jar.get(ORG_CHOICE_COOKIE)?.value);
  if (!choice) return deny("choice_expired");

  const form = await req.formData();
  const org = String(form.get("org") ?? "");
  if (!org) return deny("choice_expired");

  const allowed = await withOrg("", "staff", async (sql) => {
    const rows = await sql<{ org_slug: string }[]>`
      select org_slug from staff.list_my_orgs_for_person(${choice.personKey})
       where org_slug = ${org}
    `;
    return rows.length > 0;
  });
  if (!allowed) return deny("choice_expired");

  const outcome = await withOrg(org, "platform_super_admin", async (sql): Promise<Outcome> => {
    const [user] = await sql<FoundUser[]>`
      select id, role, active, name, session_epoch,
             (totp_confirmed_at is not null) as mfa_enrolled
        from staff.users
       where lower(email) = ${choice.email} and org_slug = ${org}
    `;
    if (!user) return { denied: "choice_expired" as const };
    if (!user.active) return { denied: "deactivated" as const };

    await sql`update staff.users set last_seen_at = now() where id = ${user.id}`;

    const [orgRow] = await sql<{ mfa_required_roles: StaffRole[] }[]>`
      select mfa_required_roles from staff.orgs where slug = ${org}
    `;

    await sql`
      insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
      values (${org}, ${user.id}, 'signin', 'user', ${user.id},
              ${sql.json({ method: "email", chose_clinic: true })})
    `;

    const state = await onboardingState(sql, user.id);
    const needsOnboarding = !state || stepFor(state) !== "done";

    return {
      user,
      mfaRequired: (orgRow?.mfa_required_roles ?? []).includes(user.role),
      needsOnboarding,
    };
  });

  if ("denied" in outcome) return deny(outcome.denied);

  const { user, mfaRequired, needsOnboarding } = outcome;
  const mfaPending = mfaRequired && !needsOnboarding;

  const session = await signSession({
    uid: user.id,
    org,
    role: user.role,
    email: choice.email,
    name: user.name,
    ep: user.session_epoch,
    mfa: mfaPending ? "pending" : "ok",
  });

  const res = redirectAfterPost(
    needsOnboarding
      ? "/staff/onboarding"
      : !mfaRequired
        ? "/staff"
        : user.mfa_enrolled
          ? "/staff/mfa"
          : "/staff/mfa/enroll"
  );
  res.cookies.set(STAFF_COOKIE, session, {
    httpOnly: true,
    secure: !isLocalRequest(req),
    sameSite: "lax",
    path: "/",
    maxAge: STAFF_COOKIE_MAX_AGE,
  });
  res.cookies.set(ORG_CHOICE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

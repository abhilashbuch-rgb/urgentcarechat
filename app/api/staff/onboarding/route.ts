import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { onboardingState, recordCredentials } from "@/lib/staff/onboarding";
import {
  signSession,
  STAFF_COOKIE,
  STAFF_COOKIE_MAX_AGE,
  type StaffRole,
} from "@/lib/staff/session";

// POST /api/staff/onboarding — the three wizard steps that are not the
// profile form and not a document signature.
//
//   confirm_job   the person confirms the job their invite assigned
//   credentials   expiry dates for what that job requires
//   orientation   acknowledges the four-screen tour
//
// One route with an action rather than three, because they are three
// steps of one flow and all three need the same auth, the same session
// and the same "did you already do this" check.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const action = String(body.action ?? "");

  return withSession(session, async (sql) => {
    const profile = await getProfile(sql, session.uid);
    if (!profile) {
      return NextResponse.json({ error: "no_profile" }, { status: 404 });
    }

    if (action === "confirm_job") {
      // THE PERSON DOES NOT CHOOSE THEIR JOB HERE. The only thing this
      // accepts is confirmation of the job already on the account, put
      // there by whoever wrote the invite. A body that names a
      // different job is rejected outright rather than quietly ignored,
      // because a request that tries it is worth failing loudly.
      //
      // Letting somebody self-select "provider" on their first screen
      // would defeat the entire separation model at the one moment
      // nobody is watching.
      if (!profile.job_role) {
        return NextResponse.json({ error: "no_job_assigned" }, { status: 409 });
      }
      if (body.job_role && body.job_role !== profile.job_role) {
        return NextResponse.json({ error: "job_not_yours" }, { status: 403 });
      }
      await sql`
        update staff.users
           set job_confirmed_at = coalesce(job_confirmed_at, now())
         where id = ${session.uid}
      `;
      await sql`
        insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
        values (${org}, ${session.uid}, 'onboarding_job_confirmed', 'user',
                ${session.uid}, ${sql.json({ job_role: profile.job_role })})
      `;
      return NextResponse.json({ ok: true });
    }

    if (action === "credentials") {
      const dates = parseDates(body.dates);
      if (dates === null) {
        return NextResponse.json({ error: "bad_dates" }, { status: 400 });
      }
      if (!profile.job_role) {
        return NextResponse.json({ error: "no_job_assigned" }, { status: 409 });
      }

      // Only kinds this job actually tracks. A hand-made request cannot
      // add a credential the roster never asked this person for.
      const allowed = await sql<{ kind: string }[]>`
        select kind::text as kind
          from staff.job_credential_requirements
         where org_slug = ${org}
           and job_role = ${profile.job_role}::staff.job_role
           and active
      `;
      const allowedKinds = new Set(allowed.map((r) => r.kind));
      const accepted = dates.filter((d) => allowedKinds.has(d.kind));

      const written = await recordCredentials(sql, {
        org,
        userId: session.uid,
        dates: accepted,
      });

      const state = await onboardingState(sql, session.uid);
      return NextResponse.json({
        ok: true,
        written,
        // So the client can render what is still missing without a
        // second round trip, and without deciding for itself.
        missing: state?.missing_credentials ?? [],
      });
    }

    if (action === "orientation") {
      await sql`
        update staff.users
           set onboarded_at = coalesce(onboarded_at, now())
         where id = ${session.uid}
      `;

      // MFA for this role was deferred at sign-in specifically so someone
      // could get through onboarding without an authenticator app already
      // asking for a username and password that don't exist yet — see
      // auth/callback and auth/email/verify. This is the first moment it
      // can be enforced, because it's the first moment onboarding is
      // actually done. The session was minted "ok" only on that promise.
      const [policy] = await sql<{ mfa_required_roles: StaffRole[] }[]>`
        select mfa_required_roles from staff.orgs where slug = ${org}
      `;
      const [user] = await sql<{ mfa_enrolled: boolean }[]>`
        select (totp_confirmed_at is not null) as mfa_enrolled
          from staff.users where id = ${session.uid}
      `;
      const mfaRequired = (policy?.mfa_required_roles ?? []).includes(session.role);

      if (mfaRequired) {
        const token = await signSession({
          uid: session.uid,
          org,
          role: session.role,
          email: session.email,
          name: session.name,
          ep: session.ep,
          mfa: "pending",
        });
        const res = NextResponse.json({
          ok: true,
          next: user?.mfa_enrolled ? "/staff/mfa" : "/staff/mfa/enroll",
        });
        res.cookies.set(STAFF_COOKIE, token, {
          httpOnly: true,
          secure: req.nextUrl.protocol === "https:",
          sameSite: "lax",
          path: "/",
          maxAge: STAFF_COOKIE_MAX_AGE,
        });
        return res;
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  });
}

/** null means the payload was the wrong shape. An empty list is valid —
 *  every field on the credentials step can legitimately be left blank if
 *  none of them are required for this job. */
function parseDates(
  raw: unknown
): { kind: string; expiresOn: string }[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 20) return null;

  const out: { kind: string; expiresOn: string }[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const rec = item as Record<string, unknown>;
    const kind = typeof rec.kind === "string" ? rec.kind : "";
    const expiresOn = typeof rec.expires_on === "string" ? rec.expires_on : "";
    if (!kind) return null;
    // Blank is how somebody skips an optional credential.
    if (!expiresOn) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return null;
    // A date the calendar does not have — 2026-02-31 — parses as a
    // different day in Postgres rather than failing, so it is caught here.
    const d = new Date(`${expiresOn}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== expiresOn) {
      return null;
    }
    out.push({ kind, expiresOn });
  }
  return out;
}

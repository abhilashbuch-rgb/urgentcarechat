import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";

// POST /api/staff/profile — the first onboarding step: who you are, and
// your consent to sign records electronically.
//
// The consent timestamp is set once and never cleared here. Withdrawing
// consent is a real right under E-SIGN, but it is not a checkbox someone
// unticks in passing — it invalidates the basis of every signature that
// follows, so it belongs in a deliberate flow with an administrator, not
// in this handler.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  let body: {
    legalName?: string;
    jobTitle?: string;
    startDate?: string;
    consent?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const legalName = (body.legalName ?? "").trim().slice(0, 120);
  const jobTitle = (body.jobTitle ?? "").trim().slice(0, 120) || null;
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(body.startDate ?? "")
    ? body.startDate!
    : null;

  if (legalName.length < 2) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json({ error: "consent_required" }, { status: 400 });
  }

  try {
    await withSession(session, async (sql) => {
      await sql`
        update staff.users
           set legal_name = ${legalName},
               job_title  = ${jobTitle},
               start_date = ${startDate}::date,
               esign_consented_at = coalesce(esign_consented_at, now())
         where id = ${session.uid}
      `;
      await sql`
        insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
        values (${org}, ${session.uid}, 'esign_consent', 'user', ${session.uid},
                ${sql.json({ legal_name: legalName, job_title: jobTitle })})
      `;
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[staff-profile] failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

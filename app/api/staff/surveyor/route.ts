import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { issueLink, revokeLink } from "@/lib/staff/surveyor";

// POST   /api/staff/surveyor — issue an inspection link
// DELETE /api/staff/surveyor?id=… — revoke one
//
// ADMINISTRATORS ONLY. Issuing one of these hands a stranger the
// clinic's entire compliance record, and that is not a decision for
// whoever happens to be at the desk when an inspector walks in.
//
// NOT GATED BY READ-ONLY BILLING — the one rule this feature exists to
// honour. A clinic with a failed card must still be able to show a
// surveyor what it already recorded.
//
// THE TOKEN IS RETURNED EXACTLY ONCE, in this response. Only its hash is
// stored, so there is no second chance to read it and no endpoint that
// can produce it again.

export const runtime = "nodejs";

const MAX_HOURS = 168; // Matches the 7-day CHECK on the table.
const MAX_LABEL = 120;

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad_json" }, { status: 400 });

  const label = String(body.label ?? "").trim().slice(0, MAX_LABEL);
  if (label.length < 3) {
    // A link with no label is an audit row that cannot answer "who did
    // you give access to in March".
    return NextResponse.json({ error: "label_required" }, { status: 400 });
  }

  const hours = Number(body.hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) {
    return NextResponse.json({ error: "bad_window" }, { status: 400 });
  }

  const link = await withSession(session, async (sql) => {
    const issued = await issueLink(sql, {
      org,
      label,
      hours,
      createdBy: session.uid,
    });
    // Audited with the label and the window — never the token or its
    // hash. An audit log holding the credential defeats the point of not
    // storing the credential.
    await sql`
      insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
      values (${org}, ${session.uid}, 'surveyor_link_issued', 'surveyor_token',
              ${issued.id}, ${sql.json({ label, hours })})
    `;
    return issued;
  });

  return NextResponse.json({ ok: true, ...link });
}

export async function DELETE(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  const done = await withSession(session, async (sql) => {
    const ok = await revokeLink(sql, { id, by: session.uid });
    if (ok) {
      await sql`
        insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id)
        values (${org}, ${session.uid}, 'surveyor_link_revoked',
                'surveyor_token', ${id})
      `;
    }
    return ok;
  });

  if (!done) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

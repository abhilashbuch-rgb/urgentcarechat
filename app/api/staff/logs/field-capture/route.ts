import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";

// POST /api/staff/logs/field-capture — record how one field's value got
// entered (typed, or a photo read the person confirmed).
//
// SEPARATE FROM THE SUBMIT ROUTE, SAME REASON AS /photo: called only
// AFTER the log is already saved, and a failure here must never look
// like a failed log — this is provenance/QA bookkeeping, not the
// compliance record. See supabase/staff-log-field-capture.sql for why
// it's its own table rather than a column on staff.form_responses.

export const runtime = "nodejs";

const FIELD_ID_RE = /^[a-z0-9_]{1,64}$/;
const RESPONSE_ID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad_body" }, { status: 400 });

  const responseId = String(body.responseId ?? "");
  const fieldId = String(body.fieldId ?? "");
  const captureMethod = body.captureMethod === "photo_confirmed" ? "photo_confirmed" : "typed";
  const aiValue = typeof body.aiValue === "number" && Number.isFinite(body.aiValue) ? body.aiValue : null;
  const aiConfidence = body.aiConfidence === "high" || body.aiConfidence === "low" ? body.aiConfidence : null;
  const confirmedValue = typeof body.confirmedValue === "number" && Number.isFinite(body.confirmedValue) ? body.confirmedValue : null;
  const model = typeof body.model === "string" ? body.model.slice(0, 80) : null;

  if (!RESPONSE_ID_RE.test(responseId)) {
    return NextResponse.json({ error: "bad_response_id" }, { status: 400 });
  }
  if (!FIELD_ID_RE.test(fieldId)) {
    return NextResponse.json({ error: "bad_field_id" }, { status: 400 });
  }

  return withSession(session, async (sql) => {
    // Same check as /photo: the response must exist and be visible
    // under this org's RLS, so a guessed id can't attach a capture
    // record to somebody else's log.
    const [row] = await sql<{ id: string }[]>`
      select id from staff.form_responses where id = ${responseId}
    `;
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await sql`
      insert into staff.log_field_captures
        (org_slug, response_id, field_id, capture_method, ai_value, ai_confidence, confirmed_value, model, created_by)
      values
        (${org}, ${responseId}, ${fieldId}, ${captureMethod}, ${aiValue}, ${aiConfidence}, ${confirmedValue}, ${model}, ${session.uid})
    `;

    return NextResponse.json({ ok: true });
  });
}

import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { runsClinic } from "@/lib/staff/roles";
import { billingState } from "@/lib/staff/billing";
import { addonEnabled, submitCount, correctCount } from "@/lib/staff/inventory";

// POST /api/staff/inventory/count — file one item's quantity/expiration,
// or correct one already filed.
//
// JSON, not a form POST, because the page submits one item at a time as
// the person works down the shelf — see app/staff/inventory/page.tsx.
// Same runsClinic() gate as the catalog route: this is the centre
// admin's job, not necessarily anything to do with their account role.
//
// COUNTS ARE APPEND-ONLY (staff.inventory_counts refuses UPDATE/DELETE
// outright — see staff-inventory.sql). A miscount is corrected by
// filing a new row with a reason, never by editing the one already
// there, same discipline as staff.form_responses.

export const runtime = "nodejs";

const MAX_NOTE = 500;
const UUID_RE = /^[0-9a-f-]{36}$/i;

function parseQuantity(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseExpiration(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : "invalid";
}

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const action = String((body as Record<string, unknown>).action ?? "submit");
  const quantity = parseQuantity((body as Record<string, unknown>).quantity);
  if (quantity === null) {
    return NextResponse.json({ error: "bad_quantity" }, { status: 400 });
  }
  const expiration = parseExpiration((body as Record<string, unknown>).expiration_date);
  if (expiration === "invalid") {
    return NextResponse.json({ error: "bad_expiration" }, { status: 400 });
  }
  const note =
    String((body as Record<string, unknown>).note ?? "").trim().slice(0, MAX_NOTE) || null;

  return withSession(session, async (sql) => {
    const me = await getProfile(sql, session.uid);
    if (!runsClinic(session.role, me?.job_role ?? null)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!(await addonEnabled(sql, org))) {
      return NextResponse.json({ error: "not_enabled" }, { status: 403 });
    }

    // Same read-only rule as filing any other log: a lapsed card pauses
    // new counts, and never hides what is already on record.
    const billing = await billingState(sql, org);
    if (billing.is_read_only) {
      return NextResponse.json({ error: "read_only" }, { status: 402 });
    }

    if (action === "correct") {
      const countId = String((body as Record<string, unknown>).count_id ?? "");
      const reason = String((body as Record<string, unknown>).reason ?? "").trim();
      if (!UUID_RE.test(countId)) {
        return NextResponse.json({ error: "bad_count_id" }, { status: 400 });
      }
      if (reason.length < 20) {
        return NextResponse.json({ error: "reason_too_short" }, { status: 400 });
      }
      const result = await correctCount(
        sql, org, countId, session.uid, quantity, expiration, note, reason
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 409 });
      }
      return NextResponse.json({ ok: true, id: result.id });
    }

    const itemId = String((body as Record<string, unknown>).item_id ?? "");
    if (!UUID_RE.test(itemId)) {
      return NextResponse.json({ error: "bad_item_id" }, { status: 400 });
    }
    const created = await submitCount(
      sql, org, itemId, session.uid, quantity, expiration, note
    );
    return NextResponse.json({ ok: true, id: created.id });
  });
}

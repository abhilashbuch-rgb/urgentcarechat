import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { billingState } from "@/lib/staff/billing";
import { roundByKey, recordRun, type RoundException } from "@/lib/staff/rounds";

// POST /api/staff/rounds/<key> — file one completed pass of a round.
//
// One request at the end of the walk, not one per step. See the header of
// supabase/staff-rounds.sql: there is no per-step record by design, so
// there is nothing to save until the person attests.
//
// GATED BY READ-ONLY, unlike the obligations register. A lobby round is
// daily workflow, which is exactly what a lapsed subscription is supposed
// to pause; an obligation is a regulatory deadline, which is not. The
// distinction is the whole rule and this route sits on the workflow side
// of it.

export const runtime = "nodejs";

const MAX_NOTE = 1000;
const MAX_EXCEPTIONS = 50;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;
  const { key } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const startedAt = new Date(String(body.started_at ?? ""));
  const exceptions = parseExceptions(body.exceptions);
  if (exceptions === null) {
    return NextResponse.json({ error: "bad_exceptions" }, { status: 400 });
  }

  return withSession(session, async (sql) => {
    const billing = await billingState(sql, org);
    if (billing.is_read_only) {
      return NextResponse.json({ error: "read_only" }, { status: 402 });
    }

    const me = await getProfile(sql, session.uid);
    const jobRole = me?.job_role ?? null;
    if (!jobRole) {
      return NextResponse.json({ error: "no_job" }, { status: 403 });
    }

    // roundByKey applies the same job filter the page did. Re-checked
    // here and not trusted from the client, because a POST is reachable
    // without ever loading the page that renders the round.
    const round = await roundByKey(sql, key, jobRole);
    if (!round) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // An exception against a step number this round does not have is
    // either a stale tab or a hand-made request. Dropped rather than
    // rejected: the walk genuinely happened, and refusing to file it
    // would lose the whole round over one bad note.
    const valid = exceptions.filter(
      (e) => e.step_no >= 1 && e.step_no <= round.steps.length
    );

    const id = await recordRun(sql, {
      org,
      roundId: round.id,
      userId: session.uid,
      startedAt,
      exceptions: valid,
    });

    if (valid.length > 0) {
      console.warn(
        `[staff-rounds] ${valid.length} reported org=${org} round=${key} run=${id}`
      );
    }

    return NextResponse.json({ ok: true, id, reported: valid.length });
  });
}

/** null means the payload was the wrong shape; an empty array is a normal
 *  and common answer. */
function parseExceptions(raw: unknown): RoundException[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_EXCEPTIONS) return null;

  const out: RoundException[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const rec = item as Record<string, unknown>;
    const stepNo = Number(rec.step_no);
    const note = typeof rec.note === "string" ? rec.note.trim() : "";
    if (!Number.isInteger(stepNo) || note.length < 3) return null;
    out.push({ step_no: stepNo, note: note.slice(0, MAX_NOTE) });
  }
  return out;
}

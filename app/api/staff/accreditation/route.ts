import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { gatherBinder } from "@/lib/staff/accreditation";
import { renderBinder } from "@/lib/staff/binder-pdf";

// GET /api/staff/accreditation?days=90 — the accreditation binder, as a PDF.
//
// CLINICAL LEADS AND ADMINISTRATORS. Not every staff member: this
// document contains the whole roster's credential status, and a single
// file holding every colleague's expiry dates is not something to hand
// out on the strength of being logged in.
//
// NOT GATED BY READ-ONLY BILLING. Same rule as the surveyor link and for
// the same reason — a clinic with a declined card must still be able to
// produce its own records for an inspector. That is the entire point of
// the non-lockout design.
//
// NODEJS RUNTIME, NOT EDGE. pdf-lib needs Buffer and the standard font
// data; the edge runtime has neither.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A 90-day binder is a few hundred rows and several drawn pages. Well
// inside the default, but stated so a clinic with three years of history
// fails visibly on the window rather than silently at the platform's
// timeout.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "clinical_lead")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const raw = Number(req.nextUrl.searchParams.get("days") ?? 90);
  // Clamped rather than rejected: somebody typing 3650 wants "all of
  // it", and the honest answer is the largest window this can render
  // rather than an error they have to decode.
  const days = Number.isFinite(raw) ? Math.min(730, Math.max(7, Math.floor(raw))) : 90;

  const started = Date.now();
  const binder = await withSession(session, (sql) => gatherBinder(sql, org, days));

  let pdf: Uint8Array;
  try {
    pdf = await renderBinder(binder);
  } catch (err) {
    // A binder that fails must say so rather than streaming a truncated
    // file — a corrupt PDF handed to a surveyor is worse than a delay.
    console.error(
      "[accreditation] render failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "render_failed" }, { status: 500 });
  }

  const ms = Date.now() - started;
  console.log(
    `[accreditation] org=${org} days=${days} bytes=${pdf.length} ms=${ms}`
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${org}-accreditation-${stamp}.pdf"`,
      "content-length": String(pdf.length),
      // Per-clinic document; never a shared cache.
      "cache-control": "private, no-store",
      "x-generation-ms": String(ms),
    },
  });
}

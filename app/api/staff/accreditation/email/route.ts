import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { gatherBinder } from "@/lib/staff/accreditation";
import { renderBinder } from "@/lib/staff/binder-pdf";
import { send, isMailConfigured } from "@/lib/mail";

// POST /api/staff/accreditation/email — the same binder the GET route
// streams for download, sent as an attachment instead.
//
// SAME AUTH, SAME BINDER, ONE DIFFERENT LAST STEP. Everything through
// rendering the PDF is identical to app/api/staff/accreditation/route.ts
// on purpose — two code paths computing "the binder" would eventually
// disagree about what is in it. Only the delivery differs.
//
// "TO ANY EMAIL" IS DELIBERATE, NOT AN OVERSIGHT. The address is
// whatever the clinical lead or administrator types — a corporate
// office, an accreditor, their own inbox, a broker. Whoever is
// authenticated for THIS org can already download this exact PDF and
// forward it to anyone; typing the address here instead of attaching a
// download in their own mail client is not a wider hole than the one
// that already exists.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s);

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "clinical_lead")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Checked before doing any work — a binder takes real seconds to
  // render, and rendering one just to discover there is nowhere to send
  // it is the wrong order to fail in.
  if (!isMailConfigured()) {
    return NextResponse.json({ error: "mail_not_configured" }, { status: 503 });
  }

  let body: { to?: string; days?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const to = (body.to ?? "").trim().toLowerCase();
  if (!isEmail(to)) {
    return NextResponse.json({ error: "bad_email" }, { status: 400 });
  }

  const raw = Number(body.days ?? 90);
  const days = Number.isFinite(raw) ? Math.min(730, Math.max(7, Math.floor(raw))) : 90;

  const started = Date.now();
  const binder = await withSession(session, (sql) => gatherBinder(sql, org, days));

  let pdf: Uint8Array;
  try {
    pdf = await renderBinder(binder);
  } catch (err) {
    console.error(
      "[accreditation:email] render failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "render_failed" }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const orgName = binder.facility?.name ?? org;

  try {
    await send({
      to,
      subject: `${orgName} — accreditation binder (${stamp})`,
      text:
        `Attached: the ${days}-day accreditation binder for ${orgName}, ` +
        `generated ${stamp} by ${session.email}.\n\n` +
        `Logs, temperature curves, staff credential status and open ` +
        `obligations, as one PDF. No patient information and nothing ` +
        `financial.`,
      attachments: [
        {
          filename: `${org}-accreditation-${stamp}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (err) {
    // Not queued, unlike the alert sweep in lib/staff/alerts.ts — this is
    // a person waiting on a response from a button they just clicked, not
    // a background sweep with a retry loop behind it. They see the
    // failure immediately and can try again or fall back to downloading
    // it themselves.
    console.error(
      "[accreditation:email] send failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  const ms = Date.now() - started;
  console.log(
    `[accreditation:email] org=${org} days=${days} bytes=${pdf.length} ms=${ms}`
  );

  return NextResponse.json({ ok: true });
}

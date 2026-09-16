import { NextRequest, NextResponse } from "next/server";
import { verifyResendWebhook } from "@/lib/staff/resend-webhook";
import {
  isFromSharps,
  orgFromRecipient,
  parsePickupDate,
  applyPickupDate,
  logRejection,
} from "@/lib/staff/waste-pickup-inbound";

// POST /api/webhooks/resend-inbound — Sharps Compliance's pickup
// confirmation email, forwarded here, moves the waste-pickup obligation
// automatically instead of an administrator retyping the date every
// time. See lib/staff/waste-pickup-inbound.ts for what it will and
// won't act on.
//
// EVERYTHING BUT THE SIGNATURE IS FORGIVING ON PURPOSE. Resend retries
// a webhook that doesn't return 2xx, and retrying a message that will
// never parse just wastes both sides' time — so anything past "this
// really came from Resend" gets a 200 whether or not it did anything,
// and the reason it didn't is in the audit log or the server log
// instead of in the response Resend sees.

export const runtime = "nodejs";

interface ResendInboundPayload {
  type?: string;
  data?: {
    from?: string;
    to?: string[] | string;
    subject?: string;
    text?: string;
    html?: string;
  };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  const verified = await verifyResendWebhook(
    raw,
    {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    },
    process.env.RESEND_INBOUND_WEBHOOK_SECRET
  );
  if (!verified.ok) {
    console.error("[resend-inbound] rejected webhook:", verified.reason);
    return NextResponse.json({ error: verified.reason }, { status: 400 });
  }

  let payload: ResendInboundPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // not ours to retry into existence
  }

  if (payload.type !== "email.received" || !payload.data) {
    return NextResponse.json({ ok: true });
  }

  const { from, to, subject, text, html } = payload.data;
  const toList = Array.isArray(to) ? to : to ? [to] : [];
  const org = toList.map(orgFromRecipient).find((o): o is string => Boolean(o)) ?? null;

  if (!org) {
    // No clinic to attribute this to — almost certainly misdirected or
    // spam. Nowhere useful to log it against, so the server log is it.
    console.error("[resend-inbound] no org in recipient list:", toList);
    return NextResponse.json({ ok: true });
  }

  if (!from || !isFromSharps(from)) {
    await logRejection(org, "sender_not_recognized", { from: from ?? null, subject: subject ?? null });
    return NextResponse.json({ ok: true });
  }

  const body = text ?? html?.replace(/<[^>]+>/g, " ") ?? "";
  const dueOn = parsePickupDate(body);
  if (!dueOn) {
    await logRejection(org, "date_not_found", { subject: subject ?? null });
    return NextResponse.json({ ok: true });
  }

  const result = await applyPickupDate(org, dueOn);
  if (!result.ok) {
    await logRejection(org, result.reason, { due_on: dueOn, subject: subject ?? null });
  }

  return NextResponse.json({ ok: true });
}

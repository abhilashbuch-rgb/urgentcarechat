import { NextRequest, NextResponse } from "next/server";
import { withOrg, isDatabaseConfigured } from "@/lib/staff/db";
import { issueChallenge, resolveInvite } from "@/lib/staff/email-auth";
import { isMailConfigured, send } from "@/lib/mail";
import { PRODUCT_NAME } from "@/lib/site";

// POST /api/staff/auth/email — ask for a sign-in code.
//
// THE ANSWER IS ALWAYS THE SAME. Invited, uninvited, never heard of —
// every case returns { ok: true } with the same wording on screen. A
// route that says "no account with that address" hands anybody with the
// form a way to enumerate who works at a clinic, and that list is worth
// having if you are phishing one.
//
// So the work is decided here and the caller learns nothing: a challenge
// is only created and emailed when an invite actually matches.

export const runtime = "nodejs";

// One address, six requests an hour. Enough for somebody who mistypes,
// deletes the mail, and tries on a second device; not enough to use the
// send route as a way to bombard an inbox.
const MAX_PER_HOUR = 6;

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "not_open_yet" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 160);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "bad_email" }, { status: 400 });
  }

  if (!isMailConfigured()) {
    // Honest rather than silent. Without this the form would claim to
    // have sent something and the person would wait for an email that
    // was never going to arrive.
    return NextResponse.json({ error: "email_not_enabled" }, { status: 503 });
  }

  const invite = await resolveInvite(email);

  if (invite) {
    const recent = await withOrg("", "signin", async (sql) => {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n
          from staff.email_auth_tokens
         where lower(email) = ${email}
           and created_at > now() - interval '1 hour'
      `;
      return row?.n ?? 0;
    });

    if (recent < MAX_PER_HOUR) {
      const challenge = await withOrg("", "signin", (sql) =>
        issueChallenge(sql, {
          email,
          ip: req.headers.get("x-forwarded-for"),
          ua: req.headers.get("user-agent"),
        })
      );

      try {
        await send({
          to: email,
          subject: `Your ${PRODUCT_NAME} sign-in code: ${challenge.code}`,
          // The code is in the SUBJECT as well as the body, so it can be
          // read from a notification without opening the mail — which is
          // the whole point on a phone at the start of a shift.
          text: [
            `Your sign-in code is ${challenge.code}`,
            "",
            "Type it into the sign-in screen, or open this link on the",
            "device you want to sign in on:",
            "",
            challenge.url,
            "",
            "It expires in 10 minutes and can be used once.",
            "",
            "If you did not ask for this, nothing has happened to your",
            "account and you can ignore this message.",
          ].join("\n"),
        });
      } catch (err) {
        // The challenge row exists but the mail did not go. Logged for
        // an operator; the caller still gets the same neutral answer,
        // because "delivery failed" is also information about whether
        // the address is real.
        console.error(
          "[email-auth] send failed:",
          err instanceof Error ? err.message : "Unknown"
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}

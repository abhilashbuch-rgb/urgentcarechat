import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/staff/db";
import { slugFrom } from "@/lib/staff/stripe";

// POST /api/trial — start a 14-day trial with no credit card.
//
// This is the only unauthenticated write in the staff system, so it is
// deliberately small: it creates an org and an invite, and nothing else.
// The org it creates is inert until someone signs in with Google using
// the address given, so a provisioned org an attacker cannot authenticate
// into is a wasted row rather than access to anything.
//
// No email is sent because none is needed: the person is standing right
// here, and the next screen tells them to sign in with the address they
// just typed.

export const runtime = "nodejs";

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s);

export async function POST(req: NextRequest) {
  let body: { clinic?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const clinic = (body.clinic ?? "").trim().slice(0, 120);
  const email = (body.email ?? "").trim().toLowerCase().slice(0, 160);

  if (clinic.length < 2) {
    return NextResponse.json({ error: "missing_clinic" }, { status: 400 });
  }
  if (!isEmail(email)) {
    return NextResponse.json({ error: "bad_email" }, { status: 400 });
  }

  try {
    const slug = await withOrg("", "platform_super_admin", async (sql) => {
      const rows = await sql<{ provision_trial: string }[]>`
        select staff.provision_trial(
          ${slugFrom(clinic, email)}, ${clinic}, ${email}, 14
        )
      `;
      return rows[0].provision_trial;
    });

    // The slug is returned so the next screen can name the workspace back
    // to them. It is not a credential — signing in still requires Google
    // plus the invited address.
    return NextResponse.json({ ok: true, slug, email });
  } catch (err) {
    console.error(
      "[trial] provisioning failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

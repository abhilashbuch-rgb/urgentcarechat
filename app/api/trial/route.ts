import { NextRequest, NextResponse } from "next/server";
import { withOrg, isDatabaseConfigured } from "@/lib/staff/db";
import { slugFrom } from "@/lib/staff/stripe";

// POST /api/trial — start a 14-day trial with no credit card.
//
// This is the only unauthenticated write in the staff system, so it is
// deliberately small: it creates an org and an invite, and nothing else.
// The org it creates is inert until someone signs in as the address
// given — with Google, or with the emailed six-digit code if that
// address isn't on Google Workspace — so a provisioned org an attacker
// cannot authenticate into is a wasted row rather than access to
// anything.
//
// No email is sent because none is needed: the person is standing right
// here, and the next screen tells them to sign in with the address they
// just typed.

export const runtime = "nodejs";

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s);

/** Mirrors the CHECK on staff.orgs.facility_type. Kept as a set here so a
 *  bad value is a silent fallback rather than a constraint violation
 *  surfacing to a visitor as "that didn't go through". */
const FACILITY_TYPES = new Set([
  "urgent_care",
  "primary_care",
  "med_spa",
  "ambulatory_surgery",
  "dental",
]);

export async function POST(req: NextRequest) {
  let body: { clinic?: string; email?: string; facility?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const clinic = (body.clinic ?? "").trim().slice(0, 120);
  // Anything unrecognised becomes urgent_care rather than an error: a
  // stale client sending nothing must still be able to sign up, and the
  // CHECK constraint would reject a typo with a 500 instead.
  const facility = FACILITY_TYPES.has(String(body.facility))
    ? String(body.facility)
    : "urgent_care";
  const email = (body.email ?? "").trim().toLowerCase().slice(0, 160);

  if (clinic.length < 2) {
    return NextResponse.json({ error: "missing_clinic" }, { status: 400 });
  }
  if (!isEmail(email)) {
    return NextResponse.json({ error: "bad_email" }, { status: 400 });
  }

  // Checked before trying, so the homepage's primary button fails
  // honestly instead of with a 500. A deployment without a staff
  // database cannot provision anything, and "that didn't save" reads to
  // the visitor as their own mistake — which is worse than saying signups
  // aren't open on this deployment yet.
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "not_open_yet" }, { status: 503 });
  }

  try {
    const slug = await withOrg("", "platform_super_admin", async (sql) => {
      const rows = await sql<{ provision_trial: string }[]>`
        select staff.provision_trial(
          ${slugFrom(clinic, email)}, ${clinic}, ${email}, 14, ${facility}
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

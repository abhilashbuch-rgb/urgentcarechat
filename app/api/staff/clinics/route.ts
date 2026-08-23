import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withOrg } from "@/lib/staff/db";
import { slugFrom } from "@/lib/staff/stripe";
import { atLeast } from "@/lib/staff/roles";

// POST /api/staff/clinics — an owner adds another clinic.
//
// ORG_ADMIN ONLY, not runsClinic(). This creates a second billed entity,
// not an operational toggle a center admin can flip — staff.add_clinic()
// enforces the same thing at the database layer, but the check is
// repeated here so a center admin gets a clean 403 instead of a raw SQL
// exception surfacing as "that didn't go through".
//
// THE NEW CLINIC IS NOT FREE. staff.add_clinic() gives it its own 14-day
// trial rather than copying the caller's live billing state — see
// supabase/staff-multisite.sql for why that used to be a real bug.

export const runtime = "nodejs";

const FACILITY_TYPES = new Set([
  "urgent_care",
  "primary_care",
  "med_spa",
  "ambulatory_surgery",
  "dental",
]);

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session } = auth.ctx;
  if (!atLeast(session.role, "org_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { name?: string; facility?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, 120);
  const facility = FACILITY_TYPES.has(String(body.facility))
    ? String(body.facility)
    : "urgent_care";
  if (name.length < 2) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }

  try {
    const slug = await withOrg("", "platform_super_admin", async (sql) => {
      const rows = await sql<{ add_clinic: string }[]>`
        select staff.add_clinic(
          ${session.email}, ${slugFrom(name, session.email)}, ${name}, ${facility}
        )
      `;
      return rows[0].add_clinic;
    });
    return NextResponse.json({ ok: true, slug });
  } catch (err) {
    console.error(
      "[clinics] add_clinic failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

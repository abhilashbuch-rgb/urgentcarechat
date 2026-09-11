import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { redirectAfterPost } from "@/lib/staff/http";
import {
  saveEmergencyContacts,
  EMERGENCY_CATEGORIES,
  CUSTOM_SLOTS,
} from "@/lib/staff/emergency-contacts";

// POST /api/staff/settings/emergency-contacts — the clinic's own list
// of numbers to call in an emergency, plus the zip that titles them.
//
// A separate form and a separate route from /api/staff/settings, same
// reason as billing-contact on that page: one shared route protected
// by one role check can only ever be as protected as the loosest thing
// in it, and this one re-checks manager+ independently.
//
// See staff-emergency-contacts.sql for why nothing here is looked up —
// every phone number is one a manager or above actually typed in.

export const runtime = "nodejs";

const isZip = (s: string) => /^[0-9]{5}(-[0-9]{4})?$/.test(s);

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "manager")) {
    return redirectAfterPost("/staff/settings?e=forbidden");
  }

  const form = await req.formData();
  const str = (k: string) => String(form.get(k) ?? "").trim();

  const zip = str("zip");
  if (zip && !isZip(zip)) {
    return redirectAfterPost("/staff/settings?e=zip");
  }

  const rows: { category: string; label: string; phone: string }[] = [];
  for (const cat of EMERGENCY_CATEGORIES) {
    const phone = str(`${cat.id}_phone`);
    if (!phone) continue; // blank phone is how a fixed line gets cleared
    const label = str(`${cat.id}_label`) || cat.label;
    rows.push({ category: cat.id, label, phone });
  }
  for (let i = 0; i < CUSTOM_SLOTS; i++) {
    const label = str(`custom_label_${i}`);
    const phone = str(`custom_phone_${i}`);
    if (!label || !phone) continue; // either blank means "not a real row"
    rows.push({ category: "other", label, phone });
  }

  try {
    await withSession(session, async (sql) => {
      await sql`select staff.update_org_zip(${org}, ${zip || null})`;
      await saveEmergencyContacts(sql, org, rows);
    });
  } catch (err) {
    console.error(
      "[emergency-contacts] save failed for org",
      org,
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/settings?e=emergencysave");
  }

  return redirectAfterPost("/staff/settings?saved=1");
}

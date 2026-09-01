import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/billing-contact — who tonight's patient count gets
// emailed to. Owner-only, deliberately stricter than the rest of
// /staff/settings (manager-level): a biller's address is money-adjacent
// the same way /staff/settings/clinics already is, and a field an MA or
// a manager could repoint is the shape of an invoice-fraud redirect, not
// a convenience. See supabase/staff-billing-stats.sql.
//
// A SEPARATE ROUTE FROM /api/staff/settings ON PURPOSE, not one more
// field folded into that shared form — that form's route only checks
// "at least manager" once for everything it accepts, so a field inside
// it can only ever be as protected as the loosest thing next to it.

export const runtime = "nodejs";

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s);

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "org_admin")) {
    return redirectAfterPost("/staff/settings?e=billingforbidden");
  }

  const form = await req.formData();
  const email = String(form.get("billing_contact_email") ?? "").trim();
  if (email && !isEmail(email)) {
    return redirectAfterPost("/staff/settings?e=billingemail");
  }

  try {
    await withSession(session, async (sql) => {
      const [before] = await sql<{ billing_contact_email: string | null }[]>`
        select billing_contact_email from staff.orgs where slug = ${org}
      `;
      await sql`select staff.update_billing_contact(${org}, ${email || null})`;

      // Who receives a nightly count of patients seen is worth a record
      // of who changed it and when — the same reasoning that makes it
      // owner-only in the first place.
      await sql`
        insert into staff.audit_log (org_slug, actor_id, action, entity, detail)
        values (${org}, ${session.uid}, 'billing_contact_changed', 'org',
                ${sql.json({ from: before?.billing_contact_email ?? null, to: email || null })})
      `;
    });
  } catch (err) {
    console.error(
      "[staff-billing-contact] save failed for org",
      org,
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/settings?e=save");
  }

  return redirectAfterPost("/staff/settings?saved=1");
}

import type { StaffSql } from "@/lib/staff/db";

// Emergency numbers a clinic wants on hand — see
// staff-emergency-contacts.sql for why this is owner-entered rather
// than looked up from a zip code.

export const EMERGENCY_CATEGORIES = [
  { id: "police", label: "Police (non-emergency line)" },
  { id: "fire_ems", label: "Fire / EMS (non-emergency line)" },
  { id: "local_er", label: "Nearest emergency room" },
  { id: "poison_control", label: "Poison control" },
  { id: "hr", label: "HR / payroll" },
] as const;

export type FixedCategory = (typeof EMERGENCY_CATEGORIES)[number]["id"];

/** How many blank custom rows to render below whatever custom entries
 *  already exist — enough to add a few more in one save without
 *  needing client JS to grow the list. */
export const CUSTOM_SLOTS = 4;

/** The one universal, verifiable number here — same toll-free line
 *  everywhere in the US. Shown only as an input placeholder, never
 *  inserted on an org's behalf: see staff-emergency-contacts.sql. */
export const POISON_CONTROL_NUMBER = "1-800-222-1222";

export interface EmergencyContact {
  id: string;
  category: FixedCategory | "other";
  label: string;
  phone: string;
  sort_order: number;
}

export async function emergencyContactsFor(
  sql: StaffSql,
  org: string
): Promise<EmergencyContact[]> {
  return sql<EmergencyContact[]>`
    select id, category, label, phone, sort_order
      from staff.emergency_contacts
     where org_slug = ${org}
     order by sort_order, label
  `;
}

/** Replaces the WHOLE set for this org — same "recompute the desired
 *  state, then save it" shape as saveBoardPrefs(). A fixed category
 *  simply isn't in `rows` when its phone field was left blank, which
 *  is how clearing one works: empty the field and save. */
export async function saveEmergencyContacts(
  sql: StaffSql,
  org: string,
  rows: { category: string; label: string; phone: string }[]
): Promise<void> {
  await sql`delete from staff.emergency_contacts where org_slug = ${org}`;
  if (rows.length === 0) return;
  await sql`
    insert into staff.emergency_contacts (org_slug, category, label, phone, sort_order)
    select ${org}, x.category, x.label, x.phone, x.ord
      from jsonb_to_recordset(${sql.json(
        rows.map((r, i) => ({ category: r.category, label: r.label, phone: r.phone, ord: i }))
      )}) as x(category text, label text, phone text, ord integer)
  `;
}

import type { StaffSql } from "@/lib/staff/db";

// Queries for the inventory add-on. See supabase/staff-inventory.sql for
// why this is its own pair of tables rather than one more
// staff.form_templates row, and why counts are append-only.
//
// None of these filter by org — RLS does that, same convention as
// lib/staff/logs.ts.

export interface InventoryItem {
  org_slug: string;
  item_id: string;
  name: string;
  category: string | null;
  unit: string;
  reorder_threshold: string | null;
  active: boolean;
  count_id: string | null;
  quantity: string | null;
  expiration_date: string | null;
  note: string | null;
  counted_at: string | null;
  counted_by: string | null;
  counted_by_name: string | null;
}

/** Whether this clinic has the add-on turned on at all. Checked at the
 *  top of the page and every route below it — a hidden nav link is a
 *  convenience, this is the control, same discipline as runsClinic(). */
export async function addonEnabled(sql: StaffSql, org: string): Promise<boolean> {
  const [row] = await sql<{ inventory_addon_enabled: boolean }[]>`
    select inventory_addon_enabled from staff.orgs where slug = ${org}
  `;
  return row?.inventory_addon_enabled ?? false;
}

export interface WeekStatus {
  week_starts_on: string;
  total_active: number;
  counted_this_week: number;
}

/** Every item — active and inactive — with its current (latest,
 *  non-superseded) count attached. Inactive items are still returned so
 *  a catalog-management screen can show "deactivated" rather than just
 *  making a row disappear with no explanation. Callers that only want
 *  what to count today filter on .active themselves. */
export async function itemsWithCurrentCounts(
  sql: StaffSql,
  org: string
): Promise<InventoryItem[]> {
  return sql<InventoryItem[]>`
    select org_slug, item_id, name, category, unit,
           reorder_threshold::text as reorder_threshold, active,
           count_id, quantity::text as quantity,
           expiration_date::text as expiration_date, note,
           counted_at::text as counted_at, counted_by, counted_by_name
      from staff.inventory_current
     where org_slug = ${org}
     order by active desc, name
  `;
}

/** Whether this week's round is done, and how far through it a clinic
 *  is. Returns null for an org where the add-on isn't on — same shape
 *  the view already filters to, kept here so a caller never has to
 *  remember the WHERE clause lives on the view. */
export async function weekStatus(
  sql: StaffSql,
  org: string
): Promise<WeekStatus | null> {
  const rows = await sql<WeekStatus[]>`
    select week_starts_on::text as week_starts_on, total_active, counted_this_week
      from staff.inventory_week_status
     where org_slug = ${org}
  `;
  return rows[0] ?? null;
}

export async function createItem(
  sql: StaffSql,
  org: string,
  createdBy: string,
  name: string,
  category: string | null,
  unit: string,
  reorderThreshold: number | null
): Promise<{ id: string }> {
  const [row] = await sql<{ id: string }[]>`
    insert into staff.inventory_items
      (org_slug, name, category, unit, reorder_threshold, created_by)
    values
      (${org}, ${name}, ${category}, ${unit}, ${reorderThreshold}, ${createdBy})
    returning id
  `;
  return row;
}

/** Toggles active rather than deleting — see the column comment in
 *  staff-inventory.sql. Scoped by org_slug in the WHERE clause as a
 *  belt-and-suspenders check; RLS already refuses a cross-org id. */
export async function setItemActive(
  sql: StaffSql,
  org: string,
  itemId: string,
  active: boolean
): Promise<void> {
  await sql`
    update staff.inventory_items set active = ${active}
     where id = ${itemId} and org_slug = ${org}
  `;
}

/** Files one item's count. Corrections go through correctCount()
 *  instead — this always inserts a fresh, non-superseding row. */
export async function submitCount(
  sql: StaffSql,
  org: string,
  itemId: string,
  countedBy: string,
  quantity: number,
  expirationDate: string | null,
  note: string | null
): Promise<{ id: string }> {
  const [row] = await sql<{ id: string }[]>`
    insert into staff.inventory_counts
      (org_slug, item_id, quantity, expiration_date, note, counted_by)
    values
      (${org}, ${itemId}, ${quantity}, ${expirationDate}, ${note}, ${countedBy})
    returning id
  `;
  return row;
}

/** Corrects a count already filed. Requires the row being corrected to
 *  be this item's CURRENT count — amending anything older would leave
 *  two corrections pointing at two different points in the same chain,
 *  same restriction staff.amend_response() applies to form_responses. */
export async function correctCount(
  sql: StaffSql,
  org: string,
  countId: string,
  countedBy: string,
  quantity: number,
  expirationDate: string | null,
  note: string | null,
  reason: string
): Promise<{ ok: true; id: string } | { ok: false; reason: "not_current" }> {
  const [current] = await sql<{ item_id: string }[]>`
    select item_id from staff.inventory_counts c
     where c.id = ${countId} and c.org_slug = ${org}
       and not exists (
             select 1 from staff.inventory_counts newer
              where newer.supersedes_id = c.id
           )
  `;
  if (!current) return { ok: false, reason: "not_current" };

  const [row] = await sql<{ id: string }[]>`
    insert into staff.inventory_counts
      (org_slug, item_id, quantity, expiration_date, note, counted_by,
       supersedes_id, correction_reason)
    values
      (${org}, ${current.item_id}, ${quantity}, ${expirationDate}, ${note},
       ${countedBy}, ${countId}, ${reason})
    returning id
  `;
  return { ok: true, id: row.id };
}

export interface ExpiringItem {
  item_id: string;
  name: string;
  unit: string;
  quantity: string;
  expiration_date: string;
}

/** Items whose current count carries stock (quantity > 0) and an
 *  expiration within the given window. For a future digest hook — not
 *  wired into the shared huddle/EOD pipeline yet, deliberately: that
 *  code already runs for every real clinic today, and this add-on is
 *  off for all of them. See the header of staff-inventory.sql. */
export async function expiringSoon(
  sql: StaffSql,
  org: string,
  withinDays: number
): Promise<ExpiringItem[]> {
  return sql<ExpiringItem[]>`
    select item_id, name, unit, quantity::text as quantity,
           expiration_date::text as expiration_date
      from staff.inventory_current
     where org_slug = ${org}
       and active
       and quantity > 0
       and expiration_date is not null
       and expiration_date <= (current_date + ${withinDays}::int)
     order by expiration_date
  `;
}

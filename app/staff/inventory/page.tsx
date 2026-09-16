import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { runsClinic } from "@/lib/staff/roles";
import { addonEnabled, itemsWithCurrentCounts, weekStatus } from "@/lib/staff/inventory";
import InventoryCountRow from "@/app/components/staff/InventoryCountRow";

// Inventory — an add-on. See supabase/staff-inventory.sql for why this
// is its own small module rather than one more clinic log, and
// lib/staff/roles.ts's runsClinic() for who reaches it: the centre
// admin BY JOB, or a manager or above BY ROLE — same gate as
// /staff/settings/logs, and for the same reason. The person who knows
// what is actually on the shelf is very often a plain "staff" account.

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  forbidden: "Only the centre admin or a manager can change the catalog.",
  bad_name: "Give the item a name.",
  bad_threshold: "The reorder number has to be zero or more.",
  bad_item: "That item could not be found.",
  bad_action: "Nothing was changed.",
  save: "Nothing was saved — try again.",
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; e?: string }>;
}) {
  const { session, org } = await requireStaff();
  const { saved, e } = await searchParams;

  const data = await withSession(session, async (sql) => ({
    profile: await getProfile(sql, session.uid),
    enabled: await addonEnabled(sql, org),
    items: await itemsWithCurrentCounts(sql, org),
    week: await weekStatus(sql, org),
  }));

  // Re-checked here, not only in the nav — see the identical note on
  // app/staff/settings/logs/page.tsx.
  const operator = runsClinic(session.role, data.profile?.job_role ?? null);
  if (!operator) redirect("/staff");

  if (!data.enabled) {
    return (
      <div className="st-page st-page-narrow">
        <header className="st-page-head">
          <h1 className="st-h1">Inventory</h1>
          <p className="st-page-sub">Not turned on for this clinic yet</p>
        </header>
        <div className="st-notice" role="status">
          <strong>This is an add-on.</strong>
          <span>
            Tracking quantity, expiration, and photos for your stock isn&rsquo;t
            included by default. Ask your administrator to have it enabled for
            this clinic.
          </span>
        </div>
      </div>
    );
  }

  const active = data.items.filter((i) => i.active);
  const inactive = data.items.filter((i) => !i.active);
  const week = data.week;
  const allDone = week !== null && week.total_active > 0 && week.counted_this_week >= week.total_active;

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <h1 className="st-h1">Inventory</h1>
        <p className="st-page-sub">
          Quantity, expiration, and a photo — once a week, whoever runs the
          building.
        </p>
      </header>

      {saved && (
        <div className="st-notice" role="status">
          <strong>Saved.</strong>
        </div>
      )}
      {e && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>Not saved</strong>
          <span>{ERRORS[e] ?? "Try again."}</span>
        </div>
      )}

      {week && week.total_active > 0 && (
        <div className={`st-notice${allDone ? "" : " st-notice-warn"}`} role="status">
          <strong>
            {allDone
              ? "This week's count is done."
              : `${week.counted_this_week} of ${week.total_active} counted this week.`}
          </strong>
          {!allDone && <span>The rest are listed below.</span>}
        </div>
      )}

      {active.length === 0 ? (
        <p className="st-empty">
          Nothing in the catalog yet. Add the first item below.
        </p>
      ) : (
        <ul className="st-record-list">
          {active.map((item) => (
            <InventoryCountRow
              key={item.item_id}
              item={{
                item_id: item.item_id,
                name: item.name,
                category: item.category,
                unit: item.unit,
                quantity: item.quantity,
                expiration_date: item.expiration_date,
                note: item.note,
                counted_at: item.counted_at,
                counted_by_name: item.counted_by_name,
              }}
            />
          ))}
        </ul>
      )}

      <section className="st-record-section">
        <h2 className="st-h2">Add an item</h2>
        <form className="st-log" method="POST" action="/api/staff/inventory/items">
          <input type="hidden" name="action" value="create" />
          <div className="st-field">
            <span className="st-field-label">Name</span>
            <input className="st-input" type="text" name="name" required maxLength={120} />
          </div>
          <div className="st-field">
            <span className="st-field-label">Category (optional)</span>
            <input className="st-input" type="text" name="category" maxLength={60} />
          </div>
          <div className="st-field">
            <span className="st-field-label">Unit</span>
            <input
              className="st-input"
              type="text"
              name="unit"
              defaultValue="each"
              maxLength={40}
            />
          </div>
          <div className="st-field">
            <span className="st-field-label">Reorder at or below (optional)</span>
            <input className="st-input" type="number" name="reorder_threshold" min={0} step="any" />
          </div>
          <button className="st-primary" type="submit">
            Add item
          </button>
        </form>
      </section>

      {inactive.length > 0 && (
        <section className="st-record-section">
          <h2 className="st-h2">Deactivated</h2>
          <ul className="st-record-list">
            {inactive.map((item) => (
              <li key={item.item_id} className="st-record-row">
                <div className="st-record-main">
                  <span className="st-record-title">{item.name}</span>
                </div>
                <form method="POST" action="/api/staff/inventory/items">
                  <input type="hidden" name="action" value="reactivate" />
                  <input type="hidden" name="item_id" value={item.item_id} />
                  <button className="st-quiet" type="submit">
                    Bring back
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {active.length > 0 && (
        <p className="st-foot">
          To remove an item from this week&rsquo;s count without losing its
          history, deactivate it — its past counts stay on the record.
        </p>
      )}
    </div>
  );
}

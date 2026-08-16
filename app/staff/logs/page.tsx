import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { todaysBoard } from "@/lib/staff/logs";
import { SLOT_LABELS, currentSlot } from "@/lib/staff/forms";
import { formatSignedAt } from "@/lib/staff/labels";

// Today's board.
//
// Sorted by when it's due, not by status, so the list is in the order a
// shift actually happens. What's done stays visible rather than
// disappearing — a board that empties as you work gives you no way to
// answer "did anyone do the fridge this morning" without digging.

export const dynamic = "force-dynamic";

export default async function LogsBoard({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const { session } = await requireStaff();
  const { done } = await searchParams;

  const rows = await withSession(session, (sql) => todaysBoard(sql));
  const now = currentSlot();

  const outstanding = rows.filter((r) => !r.response_id).length;
  const flagged = rows.filter((r) => r.has_out_of_range).length;

  return (
    <div className="st-page">
      <header className="st-page-head">
        <h1 className="st-h1">Logs</h1>
        <p className="st-page-sub">
          {outstanding === 0
            ? "Everything due today is done."
            : `${outstanding} still due today`}
          {flagged > 0 && ` · ${flagged} out of range`}
        </p>
      </header>

      {done && (
        <div className="st-notice" role="status">
          <strong>Saved.</strong>
          <span>Filed under today with your name and the time.</span>
        </div>
      )}

      {flagged > 0 && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>
            {flagged === 1
              ? "One reading today was out of range"
              : `${flagged} readings today were out of range`}
          </strong>
          <span>
            Each one was filed with the corrective action taken. They stay on
            this board rather than being cleared.
          </span>
        </div>
      )}

      <ul className="st-board">
        {rows.map((r) => {
          const isNow = r.slot === "" || r.slot === now;
          const doneAt = r.submitted_at;
          return (
            <li
              key={`${r.template_id}-${r.slot}`}
              className={`st-board-row${doneAt ? " st-board-done" : ""}${
                r.has_out_of_range ? " st-board-flag" : ""
              }`}
            >
              <div className="st-board-main">
                <span className="st-board-name">
                  {r.name}
                  {r.slot && (
                    <span className="st-board-slot">{SLOT_LABELS[r.slot]}</span>
                  )}
                </span>
                {doneAt ? (
                  <span className="st-board-meta">
                    {r.submitted_by_name ?? r.submitted_by_email} ·{" "}
                    {formatSignedAt(doneAt)}
                  </span>
                ) : (
                  <span className="st-board-meta">{r.description}</span>
                )}
              </div>

              <div className="st-board-action">
                {r.has_out_of_range && (
                  <span className="st-pill st-pill-due">Out of range</span>
                )}
                {doneAt ? (
                  <span className="st-pill st-pill-ok">Done</span>
                ) : (
                  <a
                    className={`st-board-btn${isNow ? "" : " st-board-btn-later"}`}
                    href={`/staff/logs/${r.slug}${r.slot ? `?slot=${r.slot}` : ""}`}
                  >
                    {isNow ? "Fill in" : "Fill in early"}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="st-foot">
        Rows appear from the form templates for this clinic. A twice-daily form
        shows once per shift; each is its own record.
      </p>
    </div>
  );
}

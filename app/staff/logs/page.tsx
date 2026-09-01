import Link from "next/link";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { todaysBoard, type BoardRow } from "@/lib/staff/logs";
import { getProfile } from "@/lib/staff/compliance";
import { billingState, paymentLink, type BillingState } from "@/lib/staff/billing";
import { SLOT_LABELS, currentSlot } from "@/lib/staff/forms";
import { atLeast } from "@/lib/staff/roles";
import { formatSignedAt, formatTimeOnly } from "@/lib/staff/labels";

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
  const { session, org } = await requireStaff();
  const { done } = await searchParams;

  const { rows, billing, profile } = await withSession(session, async (sql) => {
    const me = await getProfile(sql, session.uid);
    return {
      profile: me,
      // Scoped to this person's clinic job. A medical assistant does not
      // see the front desk's drawer count and vice versa. Also in her
      // own saved order, if she's set one — see "Customize my board".
      rows: await todaysBoard(sql, me?.job_role ?? null, session.uid),
      billing: await billingState(sql, org),
    };
  });
  const now = currentSlot();
  const pay = billing.is_read_only ? paymentLink() : null;

  const outstanding = rows.filter((r) => !r.response_id).length;
  // The row that was just filed, so the confirmation can name it and say
  // the time it went in. Coming back to this URL later with the query
  // string still attached shows nothing rather than a stale "saved" —
  // the row has to actually be filed for the line to appear.
  const justFiled = done
    ? rows
        .filter((r) => r.slug === done && r.submitted_at)
        .sort((a, b) => (a.submitted_at! < b.submitted_at! ? 1 : -1))[0] ?? null
    : null;
  const flagged = rows.filter((r) => r.has_out_of_range).length;
  // Split for display only — both halves already counted in outstanding
  // and flagged above, computed from the full, un-split `rows`.
  const visible = rows.filter((r) => !r.hidden);
  const hiddenRows = rows.filter((r) => r.hidden);

  return (
    <div className="st-page">
      <header className="st-page-head st-page-head-row">
        <div>
          <h1 className="st-h1">Logs</h1>
          <p className="st-page-sub">
            {outstanding === 0
              ? "Everything due today is done."
              : `${outstanding} still due today`}
            {flagged > 0 && ` · ${flagged} out of range`}
          </p>
        </div>
        {/* Reachable from every shift, not just from a settings menu
            nobody on the floor thinks to open — this is the answer to
            "why is my board in a different order than hers." */}
        <Link className="st-quiet" href="/staff/logs/customize">
          Customize my board
        </Link>
      </header>

      {billing.is_read_only && (
        <div className="st-notice st-notice-warn" role="status">
          <strong>Read-only — new entries are paused</strong>
          <span>
            Everything already recorded is still here, still searchable, and
            still exportable for a surveyor. Only new submissions are on hold
            until an administrator sorts out billing.
          </span>
          {/* THE WAY OUT, SHOWN ONLY TO SOMEBODY WHO HAS ONE.
              The banner used to end at "an administrator sorts out
              billing" with nothing to press, which for the administrator
              reading it on their own screen is a dead end. It is shown
              to owners and administrators alone: a medical assistant
              cannot act on it, and putting a payment link in front of
              one is how a personal card ends up on a clinic's
              subscription. It appears only when a link is configured,
              so a deployment without one keeps the old wording rather
              than offering a button that goes nowhere. */}
          {pay && atLeast(session.role, "org_admin") && (
            <a className="st-btn st-notice-action" href={pay}>
              Set up billing
            </a>
          )}
        </div>
      )}

      {justFiled && (
        <div className="st-notice" role="status">
          {/* NAMES THE THING AND CLOSES IT OUT.
              "Saved" answers a question about the software. What the
              person wants to know is that the fridge is handled and
              nobody is going to ask them about it again this shift. */}
          <strong>
            Filed {formatTimeOnly(justFiled.submitted_at)}.{" "}
            {justFiled.name} is covered for this shift.
          </strong>
          <span>
            {outstanding === 0
              ? "That was the last one due today."
              : outstanding === 1
                ? "One check left this shift."
                : `${outstanding} checks left this shift.`}
          </span>
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

      {!profile?.job_role && (
        <div className="st-notice" role="status">
          <strong>No job assigned yet</strong>
          <span>
            Logs are assigned by job &mdash; a medical assistant&rsquo;s shift is
            not a front desk shift. Until an administrator sets yours on the
            Team screen, you only see the tasks that apply to everyone.
          </span>
        </div>
      )}

      <ul className="st-board">
        {visible.map((r) => (
          <BoardListItem key={`${r.template_id}-${r.slot}`} r={r} now={now} billing={billing} />
        ))}
      </ul>

      {/* COLLAPSED, NEVER DROPPED. Everything in here still counted
          toward "still due today" above — this is where she put things
          she doesn't want competing for attention every shift, not
          where an owed task goes to stop being owed. See
          staff-board-prefs.sql for why hiding can never do the latter. */}
      {hiddenRows.length > 0 && (
        <details className="st-board-hidden">
          <summary>
            {hiddenRows.length} hidden from your board
            {hiddenRows.filter((r) => !r.submitted_at).length > 0 &&
              ` — ${hiddenRows.filter((r) => !r.submitted_at).length} still due`}
          </summary>
          <ul className="st-board">
            {hiddenRows.map((r) => (
              <BoardListItem key={`${r.template_id}-${r.slot}`} r={r} now={now} billing={billing} />
            ))}
          </ul>
        </details>
      )}

      <p className="st-foot">
        Rows appear from the form templates for this clinic. A twice-daily form
        shows once per shift; each is its own record.
      </p>
    </div>
  );
}

function BoardListItem({
  r,
  now,
  billing,
}: {
  r: BoardRow;
  now: string;
  billing: BillingState;
}) {
  const isNow = r.slot === "" || r.slot === now;
  const doneAt = r.submitted_at;
  return (
    <li
      className={`st-board-row${doneAt ? " st-board-done" : ""}${
        r.has_out_of_range ? " st-board-flag" : ""
      }`}
    >
      <div className="st-board-main">
        <span className="st-board-name">
          {r.name}
          {r.slot && <span className="st-board-slot">{SLOT_LABELS[r.slot]}</span>}
        </span>
        {doneAt ? (
          <span className="st-board-meta">
            {r.submitted_by_name ?? r.submitted_by_email} · {formatSignedAt(doneAt)}
          </span>
        ) : (
          <span className="st-board-meta">{r.description}</span>
        )}
      </div>

      <div className="st-board-action">
        {r.has_out_of_range && <span className="st-pill st-pill-due">Out of range</span>}
        {doneAt ? (
          <>
            <span className="st-pill st-pill-ok">Done</span>
            {!billing.is_read_only && r.response_id && (
              <a
                className="st-board-amend"
                href={`/staff/logs/${r.slug}?amend=${r.response_id}${
                  r.slot ? `&slot=${r.slot}` : ""
                }`}
              >
                Amend
              </a>
            )}
          </>
        ) : billing.is_read_only ? (
          <span className="st-pill st-pill-new">Paused</span>
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
}

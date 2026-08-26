import Link from "next/link";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import {
  register,
  dueLabel,
  repeatLabel,
  formatDue,
  type Obligation,
  type ObligationStatus,
} from "@/lib/staff/obligations";

// The register: what this organization owes, by when, and who owes it.
//
// The other two screens in this app answer "did today happen" and "has
// this person signed". Neither answers "is anything about to lapse",
// which is the question that turns into a finding.
//
// Ordered by urgency and grouped by it, with completed items kept at the
// bottom rather than removed. A register that clears itself can't answer
// "when did we last do the risk analysis" — which is the actual question
// a surveyor asks, in the past tense.

export const dynamic = "force-dynamic";

const GROUPS: { status: ObligationStatus; title: string; blurb: string }[] = [
  {
    status: "overdue",
    title: "Overdue",
    blurb: "Past their date. These are what a finding is written about.",
  },
  {
    status: "due_soon",
    title: "Next 30 days",
    blurb: "Close enough that starting now is the difference.",
  },
  {
    status: "scheduled",
    title: "Later",
    blurb: "Scheduled. Nothing to do yet.",
  },
  {
    status: "done",
    title: "Done",
    blurb:
      "Kept, not cleared. This is the half of the register you show someone.",
  },
];

export default async function ObligationsPage() {
  const { session } = await requireStaff();
  const rows = await withSession(session, register);
  const canAdd = atLeast(session.role, "manager");

  const overdue = rows.filter((r) => r.status === "overdue").length;
  const soon = rows.filter((r) => r.status === "due_soon").length;
  const unowned = rows.filter((r) => r.status !== "done" && !r.owner_id).length;

  return (
    <div className="st-page">
      <header className="st-page-head">
        <h1 className="st-h1">Obligations</h1>
        <p className="st-page-sub">
          {overdue > 0
            ? `${overdue} overdue`
            : soon > 0
              ? `Nothing overdue · ${soon} due in the next 30 days`
              : "Nothing overdue, nothing due in the next 30 days"}
          {overdue > 0 && soon > 0 && ` · ${soon} due in the next 30 days`}
        </p>
      </header>

      {unowned > 0 && (
        <div className="st-notice st-notice-warn" role="status">
          <strong>
            {unowned === 1
              ? "1 obligation has no owner"
              : `${unowned} obligations have no owner`}
          </strong>
          <span>
            An obligation nobody owns is one everybody assumes somebody else
            is doing. Open it and assign a name &mdash; that is the whole
            point of the register.
          </span>
        </div>
      )}

      {canAdd && (
        <p className="st-ob-add">
          <Link className="st-board-btn st-board-btn-later" href="/staff/obligations/new">
            Add an obligation
          </Link>
        </p>
      )}

      {GROUPS.map((group) => {
        const items = rows.filter((r) => r.status === group.status);
        if (items.length === 0) return null;
        return (
          <section className="st-ob-group" key={group.status}>
            <h2 className="st-h2">
              {group.title}
              <span className="st-ob-count">{items.length}</span>
            </h2>
            <p className="st-ob-blurb">{group.blurb}</p>
            <ul className="st-board">
              {items.map((o) => (
                <Row key={o.id} o={o} />
              ))}
            </ul>
          </section>
        );
      })}

      {rows.length === 0 && (
        <div className="st-notice" role="status">
          <strong>The register is empty</strong>
          <span>
            That normally means the obligations migration ran but the seed
            didn&rsquo;t. An empty register reads as &ldquo;nothing is
            owed&rdquo;, which is never true.
          </span>
        </div>
      )}

      <p className="st-foot">
        Overdue is worked out from the date every time this page loads, not
        set overnight by a job &mdash; so a job that stopped running can never
        show you a register with nothing late on it.
      </p>
    </div>
  );
}

function Row({ o }: { o: Obligation }) {
  const repeat = repeatLabel(o.repeat_months);
  return (
    <li
      className={`st-board-row${o.status === "done" ? " st-board-done" : ""}${
        o.status === "overdue" ? " st-board-flag" : ""
      }`}
    >
      <div className="st-board-main">
        <span className="st-board-name">
          {o.title}
          {o.category && <span className="st-board-slot">{o.category}</span>}
        </span>
        <span className="st-board-meta">
          {o.status === "done" ? (
            <>
              Done {o.completed_at ? formatDue(o.completed_at.slice(0, 10)) : ""}
              {(o.completed_by_name || o.completed_by_email) &&
                ` by ${o.completed_by_name ?? o.completed_by_email}`}
              {repeat && ` · ${repeat}`}
            </>
          ) : (
            <>
              {formatDue(o.due_on)}
              {" · "}
              {o.owner_name || o.owner_email ? (
                <>Owner: {o.owner_name ?? o.owner_email}</>
              ) : (
                <span className="st-ob-unowned">No owner</span>
              )}
              {repeat && ` · ${repeat}`}
            </>
          )}
        </span>
      </div>

      <div className="st-board-action">
        {o.status !== "done" && (
          <span
            className={`st-pill ${
              o.status === "overdue" ? "st-pill-due" : "st-pill-new"
            }`}
          >
            {dueLabel(o.days_out)}
          </span>
        )}
        {o.status === "done" && <span className="st-pill st-pill-ok">Done</span>}
        <a
          className="st-board-btn st-board-btn-later"
          href={`/staff/obligations/${o.id}`}
        >
          Open
        </a>
      </div>
    </li>
  );
}

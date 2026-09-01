import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { boardTemplatesFor } from "@/lib/staff/logs";

// Customize my board.
//
// HERS TO SET, NOT AN ADMINISTRATOR'S TO SET FOR HER. Every account down
// to a first-shift new hire may reorder and collapse their own board —
// there is no role gate here, on purpose, the same way there is none on
// /staff/me. What she cannot do is make anything disappear: "Hide" moves
// a row into the collapsed list below, still counted, still due, still
// there for anyone who opens it. See staff-board-prefs.sql.
//
// One template per row, not one row per slot — a twice-daily fridge
// check moves as a single thing rather than as two rows that could end
// up in a different order from each other.

export const dynamic = "force-dynamic";

export default async function CustomizeBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; e?: string }>;
}) {
  const { session } = await requireStaff();
  const { saved, e } = await searchParams;

  const rows = await withSession(session, async (sql) => {
    const me = await getProfile(sql, session.uid);
    return boardTemplatesFor(sql, me?.job_role ?? null, session.uid);
  });

  const visible = rows.filter((r) => !r.hidden);
  const hidden = rows.filter((r) => r.hidden);

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <h1 className="st-h1">Customize my board</h1>
        <p className="st-page-sub">
          Your own order, on this device and every device you sign into
        </p>
      </header>

      {saved && (
        <div className="st-notice" role="status">
          <strong>Saved.</strong>
          <span>Your board picks this up right away &mdash; go take a look.</span>
        </div>
      )}
      {e && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>Not saved</strong>
          <span>Nothing was changed &mdash; try again.</span>
        </div>
      )}

      <p className="st-set-b">
        Reorder to match how you actually work a shift. Hiding something
        moves it below, out of the way &mdash; it does not unassign it.
        Anything hidden is still owed today and still shows up as
        &ldquo;still due&rdquo; on your board until it&rsquo;s filed.
      </p>

      {rows.length === 0 ? (
        <p className="st-set-b">Nothing is assigned to your job yet.</p>
      ) : (
        <>
          <ul className="st-cust-list">
            {visible.map((r, i) => (
              <CustomizeRow
                key={r.slug}
                r={r}
                isFirst={i === 0}
                isLast={i === visible.length - 1}
              />
            ))}
          </ul>

          {hidden.length > 0 && (
            <>
              <h2 className="st-h2">Hidden from your board</h2>
              <ul className="st-cust-list">
                {hidden.map((r) => (
                  <CustomizeRow key={r.slug} r={r} isFirst isLast />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CustomizeRow({
  r,
  isFirst,
  isLast,
}: {
  r: { slug: string; name: string; category: string | null; hidden: boolean };
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <li className="st-cust-row">
      <div className="st-cust-name">
        <strong>{r.name}</strong>
        {r.category && <span className="st-cust-cat">{r.category}</span>}
      </div>
      <div className="st-cust-actions">
        {!r.hidden && (
          <>
            <ActionForm slug={r.slug} action="up" label="Move up" disabled={isFirst} />
            <ActionForm slug={r.slug} action="down" label="Move down" disabled={isLast} />
          </>
        )}
        <ActionForm
          slug={r.slug}
          action={r.hidden ? "show" : "hide"}
          label={r.hidden ? "Show" : "Hide"}
        />
      </div>
    </li>
  );
}

function ActionForm({
  slug,
  action,
  label,
  disabled,
}: {
  slug: string;
  action: "up" | "down" | "hide" | "show";
  label: string;
  disabled?: boolean;
}) {
  return (
    <form method="POST" action="/api/staff/logs/board-prefs">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="action" value={action} />
      <button className="st-cust-btn" type="submit" disabled={disabled}>
        {label}
      </button>
    </form>
  );
}

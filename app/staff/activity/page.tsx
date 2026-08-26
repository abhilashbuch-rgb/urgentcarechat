import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import ActivityRefresh from "@/app/components/staff/ActivityRefresh";

// The administrator's live board.
//
// NOT REALTIME, AND THAT IS THE RIGHT CALL. The staff module reaches the
// database over a direct connection so that RLS runs on
// current_setting('staff.org_slug') — supabase-js and its realtime
// channel would mean a service_role key and org scoping moved into
// application code, which is the trade this whole schema exists to
// avoid. At a few dozen filings a shift, a twenty-second refresh is
// indistinguishable from live and costs one query.
//
// IT SHOWS AMENDMENTS AS AMENDMENTS. A board that quietly swapped 55°F
// for 38.5°F would be the same lie as an editable log, just rendered
// rather than stored.

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  form_name: string;
  slot: string | null;
  submitted_at: string;
  filed_by: string | null;
  status: string;
  has_out_of_range: boolean;
  corrective_action: string | null;
  location_status: string | null;
  filed_distance_m: number | null;
  location_note: string | null;
  is_amendment: boolean;
  correction_reason: string | null;
  superseded_by: string | null;
}

function when(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function distance(m: number | null): string {
  if (m === null) return "";
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

export default async function ActivityBoard() {
  const { session, org } = await requireStaff();

  // An MA has no reason to watch the whole clinic file logs, and giving
  // them one turns a compliance tool into a surveillance one — which is
  // the single fastest way to lose staff adoption.
  if (!atLeast(session.role, "manager")) redirect("/staff");

  const rows = await withSession(session, (sql) =>
    sql<Row[]>`
      select id, form_name, slot, submitted_at::text as submitted_at,
             filed_by, status, has_out_of_range, corrective_action,
             location_status, filed_distance_m, location_note,
             is_amendment, correction_reason, superseded_by
        from staff.activity_today
       where org_slug = ${org}
       limit 200
    `
  );

  const amendments = rows.filter((r) => r.is_amendment).length;
  const offSite = rows.filter((r) => r.location_status === "off_site").length;
  const flagged = rows.filter((r) => r.has_out_of_range && !r.superseded_by).length;

  return (
    <div className="st-page">
      <ActivityRefresh seconds={20} />

      <header className="st-page-head">
        <h1 className="st-h1">Activity</h1>
        <p className="st-page-sub">
          Everything filed in the last 36 hours, newest first. Refreshes on
          its own every 20 seconds.
        </p>
      </header>

      <section className="st-stat-row">
        <div className="st-stat">
          <span className="st-stat-value">{rows.length}</span>
          <span className="st-stat-label">Entries</span>
        </div>
        <div className="st-stat">
          <span className="st-stat-value">{flagged}</span>
          <span className="st-stat-label">Out of range</span>
        </div>
        <div className="st-stat">
          <span className="st-stat-value">{amendments}</span>
          <span className="st-stat-label">Amendments</span>
        </div>
        <div className="st-stat">
          <span className="st-stat-value">{offSite}</span>
          <span className="st-stat-label">Off site</span>
        </div>
      </section>

      {rows.length === 0 ? (
        <p className="st-empty">Nothing filed yet today.</p>
      ) : (
        <ul className="st-activity">
          {rows.map((r) => (
            <li
              key={r.id}
              className={`st-act${r.superseded_by ? " st-act-old" : ""}${
                r.has_out_of_range && !r.superseded_by ? " st-act-flag" : ""
              }`}
            >
              <div className="st-act-head">
                <span className="st-act-time">{when(r.submitted_at)}</span>
                <span className="st-act-name">{r.form_name}</span>
                {r.slot && <span className="st-act-slot">{r.slot.toUpperCase()}</span>}
                {r.is_amendment && <span className="st-pill">Amendment</span>}
                {r.superseded_by && <span className="st-pill st-pill-old">Superseded</span>}
                {r.has_out_of_range && !r.superseded_by && (
                  <span className="st-pill st-pill-due">Out of range</span>
                )}
              </div>

              <div className="st-act-by">
                {r.filed_by ?? "—"}
                {r.location_status === "off_site" && (
                  <span className="st-act-off">
                    off site{r.filed_distance_m !== null && ` · ${distance(r.filed_distance_m)}`}
                  </span>
                )}
                {r.location_status === "denied" && (
                  <span className="st-act-off">location declined</span>
                )}
              </div>

              {r.correction_reason && (
                <p className="st-act-reason">
                  <strong>Amended because:</strong> {r.correction_reason}
                </p>
              )}
              {r.corrective_action && !r.superseded_by && (
                <p className="st-act-reason">
                  <strong>Action taken:</strong> {r.corrective_action}
                </p>
              )}
              {r.location_note && (
                <p className="st-act-reason">
                  <strong>Filed away from the clinic because:</strong> {r.location_note}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

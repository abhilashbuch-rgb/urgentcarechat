import type { OnDutyRole } from "@/lib/staff/roster-today";

// The top-right "who's in today" glance — the same onDutyToday() data
// the fuller .st-onduty section further down the page already shows,
// colour-coded by job so a name is identifiable by role without
// reading it (provider blue, medical assistant green, front desk
// yellow, plus x-ray tech violet and centre admin slate — see
// globals.css's root comment on --role-violet-100/700 and --role-slate-100/700 for the
// contrast numbers behind each pair). Silent when nobody is on duty,
// same as everything else on this page.
export default function OnCallStrip({ onDuty }: { onDuty: OnDutyRole[] }) {
  if (onDuty.length === 0) return null;

  return (
    <div className="st-oncall-strip" aria-label="On duty today">
      {onDuty.map((r) => (
        <span key={r.jobRole} className={`st-oncall-pill st-oncall-${r.jobRole}`}>
          <span className="st-oncall-pill-role">{r.label}</span>
          <span>{r.people.join(", ")}</span>
        </span>
      ))}
    </div>
  );
}

import type { OnDutyRole } from "@/lib/staff/roster-today";

// The top-right "who's in today" glance — the same onDutyToday() data
// the fuller .st-onduty section further down the page already shows,
// colour-coded by job so a name is identifiable by role without
// reading it (provider blue, medical assistant green, front desk
// yellow, plus x-ray tech violet and centre admin slate — see
// globals.css's root comment on --role-violet-100/700 and
// --role-slate-100/700 for the contrast numbers behind each pair).
//
// SOLID, NO NAME, UNTIL THEY'VE ACTUALLY SIGNED IN. Everyone else on
// this list is scheduled — read off a workday pattern or a manually
// filled-in shift, never a clock (see roster-today.ts's own header).
// A named, light-wash pill would say "here" about someone who has only
// been assigned, which is the schedule's claim, not a fact about this
// morning. So a person's own chip stays a plain, textless solid dot in
// their role's colour until staff.users.last_seen_at actually lands on
// today; only then does it turn into the named pill. A manual
// shift_assignments entry (no account, so nothing to sign into) never
// converts — it is always the dot.
//
// Silent when nobody is on duty, same as everything else on this page.
export default function OnCallStrip({ onDuty }: { onDuty: OnDutyRole[] }) {
  if (onDuty.length === 0) return null;

  return (
    <div className="st-oncall-strip" aria-label="On duty today">
      {onDuty.map((r) => (
        <span key={r.jobRole} className="st-oncall-group">
          <span className={`st-oncall-role-label st-oncall-${r.jobRole}`}>{r.label}</span>
          {r.people.map((p) => (
            <span
              key={p.name}
              className={
                p.signedInToday
                  ? `st-oncall-pill st-oncall-${r.jobRole}`
                  : `st-oncall-dot st-oncall-${r.jobRole}`
              }
              title={p.signedInToday ? undefined : `${p.name} — expected, not signed in yet`}
            >
              {p.signedInToday ? p.name : <span className="st-sr-only">{p.name}, not signed in yet</span>}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

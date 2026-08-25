import { formatSignedAt } from "@/lib/staff/labels";
import type { SigninEvent } from "@/lib/staff/signins";

// The same list, for two audiences: an employee's own record (their
// record, not the employer's copy of it — see app/staff/me/page.tsx),
// and an administrator looking at one person on the team
// (app/staff/team/[id]/page.tsx). One component so the two views cannot
// drift apart on what a sign-in event actually shows.

const METHOD_LABELS: Record<string, string> = {
  email: "Emailed code",
  google: "Google",
};

export default function SigninHistory({ events }: { events: SigninEvent[] }) {
  if (events.length === 0) {
    return <p className="st-empty">No sign-ins on record yet.</p>;
  }

  return (
    <ul className="st-record-list">
      {events.map((e) => (
        <li key={e.id} className="st-record-row">
          <div className="st-record-main">
            <span className="st-record-title">{formatSignedAt(e.created_at)}</span>
          </div>
          <span className="st-record-when">
            {e.method ? METHOD_LABELS[e.method] ?? e.method : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

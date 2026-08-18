import Link from "next/link";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { roundsFor, type RoundSummary } from "@/lib/staff/rounds";
import { formatSignedAt } from "@/lib/staff/labels";

// The rounds this job walks, grouped by when they are walked.
//
// GROUPED BY CADENCE, NOT BY SUBJECT. "Every hour", "at open", "at
// close", "when it happens" is the question the person actually has at
// 2pm. A round filed under "infection control" is a round nobody opens.

export const dynamic = "force-dynamic";

// Fixed order, so "when it happens" never sorts above "at open" just
// because a clinic added it first. Anything a clinic invents falls to
// the end rather than disappearing.
const CADENCE_ORDER = ["every hour", "at open", "at close", "when it happens"];

export default async function RoundsPage() {
  const { session } = await requireStaff();

  const { rounds, jobRole } = await withSession(session, async (sql) => {
    const me = await getProfile(sql, session.uid);
    const job = me?.job_role ?? null;
    return { jobRole: job, rounds: await roundsFor(sql, job) };
  });

  const groups = new Map<string, RoundSummary[]>();
  for (const r of rounds) {
    const list = groups.get(r.cadence) ?? [];
    list.push(r);
    groups.set(r.cadence, list);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) => rank(a[0]) - rank(b[0])
  );

  return (
    <div className="st-page">
      <header className="st-page-head">
        <h1 className="st-h1">Rounds</h1>
        <p className="st-page-sub">
          Walked in order, one step at a time. You sign once, at the end.
        </p>
      </header>

      {!jobRole && (
        <div className="st-notice st-notice-warn" role="status">
          <strong>No job assigned to your account yet</strong>
          <span>
            Rounds are assigned per job. Ask an administrator to set yours on
            the Team page.
          </span>
        </div>
      )}

      {rounds.length === 0 && jobRole && (
        <p className="st-empty">No rounds are set up for your job yet.</p>
      )}

      {ordered.map(([cadence, list]) => (
        <section key={cadence} className="st-section">
          <h2 className="st-h2">{sentenceCase(cadence)}</h2>
          <div className="st-round-list">
            {list.map((r) => (
              <Link
                key={r.key}
                className="st-round"
                href={`/staff/rounds/${encodeURIComponent(r.key)}`}
              >
                <span className="st-round-main">
                  <span className="st-round-title">{r.title}</span>
                  {r.purpose && (
                    <span className="st-round-purpose">{r.purpose}</span>
                  )}
                </span>
                <span className="st-round-meta">
                  <span className="st-round-steps">{r.step_count} steps</span>
                  {/* Last walked, in full — "2 hours ago" would let an
                      hourly round look recent all afternoon. */}
                  <span className="st-round-last">
                    {r.last_walked_at
                      ? `Last walked ${formatSignedAt(r.last_walked_at)}${
                          r.last_walked_by ? ` by ${r.last_walked_by}` : ""
                        }`
                      : "Never walked"}
                  </span>
                  {r.last_exception_count > 0 && (
                    <span className="st-round-flag">
                      {r.last_exception_count} reported last time
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function rank(cadence: string): number {
  const i = CADENCE_ORDER.indexOf(cadence.toLowerCase());
  return i === -1 ? CADENCE_ORDER.length : i;
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

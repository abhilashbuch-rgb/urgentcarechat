import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { roundByKey } from "@/lib/staff/rounds";
import { billingState } from "@/lib/staff/billing";
import RoundRunner from "@/app/components/staff/RoundRunner";

// One round, walked.
//
// The steps are sent to the client because the whole point is that the
// next one appears instantly when you move on — a round that waits on a
// request at every step is a round people abandon at step four, standing
// in a restroom on clinic wifi.
//
// Sending them all does NOT mean the client decides anything. It has no
// state worth forging: what gets stored is a start time, an end time, a
// person, and any problems reported. The job check that decides whether
// this person may walk this round at all happens here AND again in the
// POST route.

export const dynamic = "force-dynamic";

export default async function RoundPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { session, org } = await requireStaff();
  const { key } = await params;

  const { round, jobRole, billing } = await withSession(session, async (sql) => {
    const me = await getProfile(sql, session.uid);
    const job = me?.job_role ?? null;
    return {
      jobRole: job,
      round: await roundByKey(sql, key, job),
      billing: await billingState(sql, org),
    };
  });

  // No job set is its own answer, and a different one from "this round
  // isn't yours" — one is fixed by an administrator, the other is not a
  // problem at all.
  if (!jobRole) {
    return (
      <div className="st-page">
        <header className="st-page-head">
          <h1 className="st-h1">Rounds</h1>
        </header>
        <div className="st-notice st-notice-warn" role="status">
          <strong>No job assigned to your account yet</strong>
          <span>
            Rounds are assigned per job. Ask an administrator to set yours on
            the Team page.
          </span>
        </div>
      </div>
    );
  }

  if (!round) notFound();

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <p className="st-round-crumb">
          <Link href="/staff/rounds">Rounds</Link> · {sentenceCase(round.cadence)}
        </p>
        <h1 className="st-h1">{round.title}</h1>
        {round.purpose && <p className="st-page-sub">{round.purpose}</p>}
      </header>

      {billing.is_read_only ? (
        <div className="st-notice st-notice-warn" role="status">
          <strong>Read-only — new entries are paused</strong>
          <span>
            You can still read the steps and walk the round; it just can&rsquo;t
            be signed for until an administrator sorts out billing.
          </span>
        </div>
      ) : null}

      <RoundRunner
        roundKey={round.key}
        title={round.title}
        steps={round.steps}
      />
    </div>
  );
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

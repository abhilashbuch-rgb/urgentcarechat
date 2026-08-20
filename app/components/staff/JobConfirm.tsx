"use client";

import { useState } from "react";

// Step two: confirm the job you were invited as.
//
// THIS IS NOT A PICKER, AND THAT IS THE POINT. The job decides which
// board you see, which rounds you walk, and which scope of practice
// applies to you — the whole separation model rests on it. Offering five
// cards to somebody on their first morning would let a new hire assign
// themselves "Provider" at the one moment nobody is watching.
//
// So there is one job shown, the one the invite carried, and two ways
// out: confirm it, or say it is wrong. Saying it is wrong does not open
// a picker either — it stops, and an administrator fixes the invite.
// That is a slower path and it is the correct one.

export default function JobConfirm({
  jobLabel,
  jobRole,
  scope,
}: {
  jobLabel: string;
  jobRole: string;
  /** A few lines of what this job does and does not do, so "confirm"
   *  means something more than recognising a title. */
  scope: { authorized: string[]; prohibited: string[] };
}) {
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/staff/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "confirm_job", job_role: jobRole }),
    }).catch(() => null);

    if (!res?.ok) {
      setBusy(false);
      setError("That didn't save. Try again — nothing was recorded.");
      return;
    }
    window.location.assign("/staff/onboarding");
  }

  if (wrong) {
    return (
      <div className="st-sign">
        <div className="st-notice st-notice-warn" role="status">
          <strong>Stop here</strong>
          <span>
            Your job decides what you see and what you are allowed to do, so
            it is not something to work around. Tell whoever invited you that
            the invite says {jobLabel.toLowerCase()}. They can change it, and
            you can pick this back up straight afterwards.
          </span>
        </div>
        <button className="st-btn" onClick={() => setWrong(false)}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="st-sign">
      <div className="st-job-card">
        <p className="st-job-eyebrow">You were invited as</p>
        <p className="st-job-name">{jobLabel}</p>
      </div>

      <div className="st-job-scope">
        <div>
          <p className="st-job-scope-head">Yours to do</p>
          <ul>
            {scope.authorized.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="st-job-scope-head">Never yours</p>
          <ul>
            {scope.prohibited.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="st-sign-fine">
        This is the full list once you are in, under Rules. Confirming means
        you have read which side of that line your job sits on.
      </p>

      {error && (
        <p className="st-run-error" role="alert">
          {error}
        </p>
      )}

      <div className="st-run-actions">
        <button
          className="st-btn st-btn-quiet"
          onClick={() => setWrong(true)}
          disabled={busy}
        >
          That&rsquo;s not my job
        </button>
        <button
          className="st-btn st-btn-primary"
          onClick={confirm}
          disabled={busy}
        >
          {busy ? "Saving…" : `Yes, I'm ${jobLabel.toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}

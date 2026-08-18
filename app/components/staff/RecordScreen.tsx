"use client";

import { useState } from "react";

// Recording one exclusion screen.
//
// Clear is one tap, because that is the outcome ninety-nine times in a
// hundred and making it a form would mean it gets done in a batch at the
// end of the month from memory. Anything other than clear opens a box and
// will not submit empty — a possible match with no note is the same as no
// screen at all, and the constraint behind this refuses it anyway.

export default function RecordScreen({
  userId, source, name,
}: {
  userId: string; source: string; name: string;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(result: string) {
    setBusy(true); setErr(null);
    const res = await fetch("/api/staff/roster", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, source, result, detail: detail.trim() }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setErr(res?.status === 403 ? "Your role can't record screenings."
           : res?.status === 400 ? "Say what was found before recording a match."
           : "That didn't save.");
      return;
    }
    window.location.reload();
  }

  if (!open) {
    return (
      <button className="st-board-btn" type="button" onClick={() => setOpen(true)}>
        Record
      </button>
    );
  }

  return (
    <div className="st-rec">
      <p className="st-rec-who">{name}</p>
      <div className="st-rec-row">
        <button className="st-board-btn" type="button" disabled={busy}
                onClick={() => send("clear")}>
          {busy ? "Saving…" : "Clear"}
        </button>
        <button className="st-board-btn st-board-btn-later" type="button"
                disabled={busy || detail.trim().length < 3}
                onClick={() => send("possible_match")}>
          Possible match
        </button>
        <button className="st-board-btn st-board-btn-later" type="button"
                disabled={busy || detail.trim().length < 3}
                onClick={() => send("excluded")}>
          Excluded
        </button>
      </div>
      <textarea
        className="st-textarea" rows={2} value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="Required for a match: what you found and what you did about it."
        aria-label="What was found"
      />
      {err && <p className="st-sign-error" role="alert">{err}</p>}
      <button className="st-ob-disclose" type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

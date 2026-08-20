"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { RoundStep, RoundException } from "@/lib/staff/rounds";

// The round, walked one step at a time.
//
// ONE STEP ON SCREEN. NEXT. THEN ATTEST. THEN FINISHED.
//
// There is no checkbox anywhere in here, and that is the entire design.
// A list of twelve checkboxes is satisfiable from the counter in nine
// seconds without walking anywhere, and the resulting record is
// indistinguishable from an honest one — which makes it worse than no
// record, because a manager reading it believes the lobby was checked.
// With one instruction on screen and the next hidden behind a button,
// the fastest route through is the walk itself.
//
// So Next is not a "mark done" control. It means "I have done this and I
// am moving on", and the only thing stored is that this person went
// through the whole thing and signed for it at the end.
//
// BACK EXISTS. Somebody who taps Next early has to be able to return, or
// they will finish the round with a step they know they skipped and the
// attestation becomes something people sign while knowing it is untrue —
// which is how an attestation stops meaning anything.
//
// REPORT A PROBLEM IS ON EVERY STEP and is the only thing that writes
// text. It is what stops a round being a rubber stamp: an out-of-paper
// restroom, a dead bulb, a spill. Reporting one does NOT stop the walk —
// it is noted and you carry on, because stopping the round to file a
// note is how notes stop being filed.

const ERRORS: Record<string, string> = {
  read_only:
    "New entries are paused while billing is sorted out. Everything already recorded is still here.",
  not_found: "This round no longer exists.",
  forbidden: "This round isn't one your job walks.",
  no_job:
    "Your account has no job set yet, so there's nothing assigned to you. Ask an administrator to set it.",
};

export default function RoundRunner({
  roundKey,
  title,
  steps,
}: {
  roundKey: string;
  title: string;
  steps: RoundStep[];
}) {
  // -1 is the start card, steps.length is the attestation, and anything
  // between is a step. One number rather than a phase enum plus an index,
  // because two pieces of state that must agree eventually disagree.
  const [at, setAt] = useState(-1);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exceptions, setExceptions] = useState<RoundException[]>([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  // When the walk actually began. Set on the first Next, not on page
  // load — a page left open on a counter all morning would otherwise
  // report a four-hour round.
  const startedAt = useRef<string | null>(null);

  const total = steps.length;
  const step = at >= 0 && at < total ? steps[at] : null;
  const attesting = at === total;

  function begin() {
    startedAt.current = new Date().toISOString();
    setAt(0);
  }

  function next() {
    setNoteOpen(false);
    setNote("");
    setAt((n) => n + 1);
  }

  function back() {
    setNoteOpen(false);
    setNote("");
    setAt((n) => Math.max(0, n - 1));
  }

  function saveNote() {
    const text = note.trim();
    if (text.length < 3 || !step) return;
    setExceptions((list) => [
      ...list.filter((e) => e.step_no !== step.step_no),
      { step_no: step.step_no, note: text },
    ]);
    setNoteOpen(false);
    setNote("");
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/staff/rounds/${roundKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          started_at: startedAt.current ?? new Date().toISOString(),
          exceptions,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(ERRORS[body?.error] ?? "That didn't save. Try once more.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError("That didn't save. Check your connection and try once more.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="st-run st-run-done">
        <p className="st-run-finished">Finished</p>
        <h2 className="st-run-instruction">{title} is signed for.</h2>
        <p className="st-run-detail">
          {exceptions.length === 0
            ? "Nothing reported."
            : `${exceptions.length} ${
                exceptions.length === 1 ? "problem" : "problems"
              } reported and on the record.`}
        </p>
        <div className="st-run-actions">
          <Link className="st-btn st-btn-primary" href="/staff/rounds">
            Back to rounds
          </Link>
        </div>
      </div>
    );
  }

  // The start card. Says how many steps, so nobody begins a twelve-step
  // walk believing it is three.
  if (at < 0) {
    return (
      <div className="st-run">
        <p className="st-run-count">{total} steps</p>
        <h2 className="st-run-instruction">Walk it in order.</h2>
        <p className="st-run-detail">
          One step at a time. The next one appears when you move on. You sign
          once, at the end.
        </p>
        <div className="st-run-actions">
          <button className="st-btn st-btn-primary" onClick={begin}>
            Start
          </button>
        </div>
      </div>
    );
  }

  if (attesting) {
    return (
      <div className="st-run">
        <p className="st-run-count">Last step</p>
        <h2 className="st-run-instruction">Sign for the round.</h2>
        {/* The attestation is written out in full rather than reduced to
            "I confirm the above". A signature means what it says, and a
            person should be able to read what they are signing without
            scrolling back. */}
        {/* Lowercased and preceded by "the": round titles are written as
            headings ("Hourly lobby round"), and dropped into a sentence
            verbatim they read as a proper noun. */}
        <p className="st-run-attest">
          I walked every step of the {title.toLowerCase()} myself, just now,
          and what I have reported is what I found.
        </p>

        {exceptions.length > 0 && (
          <div className="st-run-reported">
            <p className="st-run-reported-head">
              Going on the record with this round
            </p>
            <ul>
              {exceptions
                .slice()
                .sort((a, b) => a.step_no - b.step_no)
                .map((e) => (
                  <li key={e.step_no}>
                    <span className="st-run-reported-step">
                      Step {e.step_no}
                    </span>
                    {e.note}
                  </li>
                ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="st-run-error" role="alert">
            {error}
          </p>
        )}

        <div className="st-run-actions">
          <button className="st-btn" onClick={back} disabled={busy}>
            Back
          </button>
          <button
            className="st-btn st-btn-primary"
            onClick={finish}
            disabled={busy}
          >
            {busy ? "Signing…" : "Sign and finish"}
          </button>
        </div>
      </div>
    );
  }

  const flagged = exceptions.some((e) => e.step_no === step!.step_no);

  return (
    <div className="st-run">
      <div className="st-run-progress" aria-hidden="true">
        <span
          className="st-run-progress-fill"
          style={{ width: `${((at + 1) / (total + 1)) * 100}%` }}
        />
      </div>
      <p className="st-run-count">
        Step {at + 1} of {total}
      </p>

      <h2 className="st-run-instruction">{step!.instruction}</h2>
      {step!.detail && <p className="st-run-detail">{step!.detail}</p>}

      {flagged && !noteOpen && (
        <p className="st-run-flagged">Problem reported on this step.</p>
      )}

      {noteOpen ? (
        <div className="st-run-note">
          <label className="st-label" htmlFor="round-note">
            What did you find?
          </label>
          <textarea
            id="round-note"
            className="st-textarea"
            rows={3}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Out of paper towels in the left restroom."
          />
          <div className="st-run-actions">
            <button
              className="st-btn"
              onClick={() => {
                setNoteOpen(false);
                setNote("");
              }}
            >
              Cancel
            </button>
            <button
              className="st-btn st-btn-primary"
              onClick={saveNote}
              disabled={note.trim().length < 3}
            >
              Add to the record
            </button>
          </div>
        </div>
      ) : (
        <div className="st-run-actions">
          {at > 0 && (
            <button className="st-btn" onClick={back}>
              Back
            </button>
          )}
          <button
            className="st-btn st-btn-quiet"
            onClick={() => {
              setNoteOpen(true);
              setNote(
                exceptions.find((e) => e.step_no === step!.step_no)?.note ?? ""
              );
            }}
          >
            {flagged ? "Edit the problem" : "Report a problem"}
          </button>
          {/* Always "Next", including on the last step — the button that
              follows it is the attestation, and renaming this one to
              "Finish" would let somebody sign without seeing what they
              are signing. */}
          <button className="st-btn st-btn-primary" onClick={next}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

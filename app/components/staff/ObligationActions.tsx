"use client";

import { useState } from "react";
import type { ObligationStatus } from "@/lib/staff/obligations";

// The things you can do to an obligation, in the order you are likely to
// want them.
//
// Completing is the primary action and it is one box and one button.
// Everything else — reassigning, moving the date, reopening, retiring —
// is deliberately behind a disclosure, because they are all edits to the
// compliance calendar rather than work being done, and a screen that
// offers "change the due date" as prominently as "mark it done" is a
// screen that suggests moving the date is the normal response to a
// deadline.

type Action = "complete" | "reopen" | "assign" | "reschedule" | "retire";

const ERRORS: Record<string, string> = {
  not_yours:
    "This one is assigned to somebody else. A clinical lead can complete it, or reassign it to you first.",
  already_done: "Someone else marked this done while this page was open.",
  evidence_required:
    "Say what was actually done. A date with nothing under it isn't evidence.",
  reason_required: "A reason is required.",
  not_completed: "This isn't marked done, so there's nothing to reopen.",
  completion_immutable:
    "A recorded completion can't be edited. Reopen it and complete it again — both stay on the record.",
  no_such_owner: "That person isn't on the active roster any more.",
  bad_due_date: "That date didn't parse.",
  forbidden: "Your role can't do that.",
  not_found: "This obligation no longer exists.",
};

export default function ObligationActions({
  id,
  status,
  dueOn,
  ownerId,
  canComplete,
  isLead,
  isAdmin,
  team,
}: {
  id: string;
  status: ObligationStatus;
  dueOn: string;
  ownerId: string | null;
  canComplete: boolean;
  isLead: boolean;
  isAdmin: boolean;
  team: { id: string; label: string }[];
}) {
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [owner, setOwner] = useState(ownerId ?? "");
  const [due, setDue] = useState(dueOn);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function send(action: Action, payload: Record<string, unknown>) {
    setBusy(action);
    setError(null);
    const res = await fetch(`/api/staff/obligations/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    }).catch(() => null);

    if (!res?.ok) {
      setBusy(null);
      const body = await res?.json().catch(() => null);
      setError(
        ERRORS[body?.error as string] ??
          "That didn't save. Nothing was changed — try again."
      );
      return;
    }
    // Retiring removes it from the register, so there is nothing left to
    // come back to.
    window.location.assign(
      action === "retire" ? "/staff/obligations" : `/staff/obligations/${id}`
    );
  }

  return (
    <div className="st-ob-actions">
      {error && (
        <p className="st-sign-error" role="alert">
          {error}
        </p>
      )}

      {status !== "done" && canComplete && (
        <section className="st-ob-complete">
          <h2 className="st-h2">Mark it done</h2>
          <label className="st-ob-label" htmlFor="ob-evidence">
            What was done, and where the proof lives
          </label>
          <textarea
            id="ob-evidence"
            className="st-textarea"
            rows={3}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="e.g. SRA completed with Nixon Health 8/14; report filed in the compliance binder and on the shared drive under 2026/HIPAA."
          />
          <p className="st-log-hint">
            This sentence is what gets shown to a surveyor. Name the document
            and where it is &mdash; six months from now nobody remembers.
          </p>
          <button
            className="st-primary"
            type="button"
            disabled={busy !== null || evidence.trim().length < 3}
            onClick={() => send("complete", { evidence: evidence.trim() })}
          >
            {busy === "complete" ? "Saving…" : "Mark done"}
          </button>
        </section>
      )}

      {status !== "done" && !canComplete && (
        <p className="st-log-hint">
          This is assigned to someone else. A clinical lead can complete it or
          reassign it.
        </p>
      )}

      {(isLead || isAdmin) && (
        <section className="st-ob-more">
          <button
            className="st-ob-disclose"
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Change owner, date, or status"}
          </button>

          {open && (
            <div className="st-ob-more-body">
              {isLead && (
                <div className="st-ob-field">
                  <label className="st-ob-label" htmlFor="ob-owner">
                    Owner
                  </label>
                  <select
                    id="ob-owner"
                    className="st-input st-select"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                  >
                    <option value="">Nobody</option>
                    {team.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="st-board-btn st-board-btn-later"
                    type="button"
                    disabled={busy !== null || owner === (ownerId ?? "")}
                    onClick={() => send("assign", { ownerId: owner || null })}
                  >
                    {busy === "assign" ? "Saving…" : "Assign"}
                  </button>
                </div>
              )}

              {/* Not offered once it's done. The due date of a completed
                  obligation is the half of the record that says whether it
                  was on time, and the next occurrence has already been
                  dated from it. Reopening is the way back. */}
              {isLead && status !== "done" && (
                <div className="st-ob-field">
                  <label className="st-ob-label" htmlFor="ob-due">
                    Due date
                  </label>
                  <input
                    id="ob-due"
                    className="st-input st-input-date"
                    type="date"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                  />
                  <button
                    className="st-board-btn st-board-btn-later"
                    type="button"
                    disabled={busy !== null || due === dueOn}
                    onClick={() => send("reschedule", { dueOn: due })}
                  >
                    {busy === "reschedule" ? "Saving…" : "Move"}
                  </button>
                  <p className="st-log-hint">
                    Moving a date is recorded in the audit log with the old one.
                    It is a legitimate thing to do and a bad thing to do
                    quietly.
                  </p>
                </div>
              )}

              <div className="st-ob-field">
                <label className="st-ob-label" htmlFor="ob-reason">
                  {status === "done"
                    ? "Reason for reopening"
                    : "Reason for retiring this obligation"}
                </label>
                <textarea
                  id="ob-reason"
                  className="st-textarea"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    status === "done"
                      ? "e.g. Marked done against the wrong year's report."
                      : "e.g. This site has no plumbed eyewash; portable units are logged under first aid."
                  }
                />
                <div className="st-ob-row">
                  {status === "done" && isLead && (
                    <button
                      className="st-board-btn st-board-btn-later"
                      type="button"
                      disabled={busy !== null || reason.trim().length < 3}
                      onClick={() => send("reopen", { reason: reason.trim() })}
                    >
                      {busy === "reopen" ? "Saving…" : "Reopen"}
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      className="st-board-btn st-board-btn-later"
                      type="button"
                      disabled={busy !== null || reason.trim().length < 3}
                      onClick={() => send("retire", { reason: reason.trim() })}
                    >
                      {busy === "retire" ? "Saving…" : "Doesn't apply to us"}
                    </button>
                  )}
                </div>
                <p className="st-log-hint">
                  Retiring hides it from the register. It is not deleted, and
                  the reason is kept &mdash; &ldquo;we decided this
                  doesn&rsquo;t apply&rdquo; is itself something a surveyor can
                  ask about.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

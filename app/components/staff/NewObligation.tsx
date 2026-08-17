"use client";

import { useState } from "react";
import { CATEGORIES } from "@/lib/staff/obligations";

// Six fields, three of them optional, one of them the point.
//
// The point is the due date. Everything else is context; a register entry
// without a date is a note, and notes are what this replaces.

const REPEATS: { value: string; label: string }[] = [
  { value: "", label: "One-off" },
  { value: "1", label: "Monthly" },
  { value: "3", label: "Quarterly" },
  { value: "6", label: "Twice a year" },
  { value: "12", label: "Annually" },
  { value: "24", label: "Every two years" },
];

export default function NewObligation({
  team,
}: {
  team: { id: string; label: string }[];
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [category, setCategory] = useState("");
  const [citation, setCitation] = useState("");
  const [source, setSource] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [repeatMonths, setRepeatMonths] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = title.trim().length > 2 && /^\d{4}-\d{2}-\d{2}$/.test(dueOn);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/staff/obligations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        detail: detail.trim(),
        category,
        citation: citation.trim(),
        source: source.trim(),
        dueOn,
        ownerId: ownerId || null,
        repeatMonths: repeatMonths ? Number(repeatMonths) : null,
      }),
    }).catch(() => null);

    if (!res?.ok) {
      setBusy(false);
      setError(
        res?.status === 403
          ? "Only an administrator can add obligations."
          : "That didn't save. Nothing was added — try again."
      );
      return;
    }
    window.location.assign("/staff/obligations");
  }

  return (
    <form className="st-log" onSubmit={submit}>
      <div className="st-ob-field">
        <label className="st-ob-label" htmlFor="ob-title">
          What is owed
        </label>
        <input
          id="ob-title"
          className="st-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Switch the EHR to multi-factor authentication"
          autoFocus
        />
      </div>

      <div className="st-ob-field">
        <label className="st-ob-label" htmlFor="ob-due">
          Due by
        </label>
        <input
          id="ob-due"
          className="st-input st-input-date"
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
        />
      </div>

      <div className="st-ob-field">
        <label className="st-ob-label" htmlFor="ob-owner">
          Owner
        </label>
        <select
          id="ob-owner"
          className="st-input st-select"
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
        >
          <option value="">Assign later</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="st-log-hint">
          Leaving it unassigned is allowed and the register will say so in red.
          It is the honest state, not a neutral one.
        </p>
      </div>

      <div className="st-ob-field">
        <label className="st-ob-label" htmlFor="ob-repeat">
          Repeats
        </label>
        <select
          id="ob-repeat"
          className="st-input st-select"
          value={repeatMonths}
          onChange={(e) => setRepeatMonths(e.target.value)}
        >
          {REPEATS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <p className="st-log-hint">
          A recurring obligation creates its next occurrence the moment this
          one is completed, dated from the due date rather than the completion
          date.
        </p>
      </div>

      <div className="st-ob-field">
        <label className="st-ob-label" htmlFor="ob-detail">
          What it involves
        </label>
        <textarea
          id="ob-detail"
          className="st-textarea"
          rows={3}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="What actually has to happen, and anything the person doing it will otherwise have to go and ask about."
        />
      </div>

      <div className="st-ob-field">
        <label className="st-ob-label" htmlFor="ob-category">
          Category
        </label>
        <select
          id="ob-category"
          className="st-input st-select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">None</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="st-ob-field">
        <label className="st-ob-label" htmlFor="ob-source">
          Where it came from
        </label>
        <input
          id="ob-source"
          className="st-input"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="e.g. Franchise bulletin, August 2026"
        />
        <p className="st-log-hint">
          The first question about anything on a compliance list is who put it
          there.
        </p>
      </div>

      <div className="st-ob-field">
        <label className="st-ob-label" htmlFor="ob-citation">
          Rule or citation
        </label>
        <input
          id="ob-citation"
          className="st-input"
          value={citation}
          onChange={(e) => setCitation(e.target.value)}
          placeholder="e.g. 45 CFR 164.312(d) — leave blank if it isn't a regulation"
        />
        <p className="st-log-hint">
          Leave it blank rather than guessing. A citation that turns out not to
          say what the row claims costs the credibility of every other row.
        </p>
      </div>

      {error && (
        <p className="st-sign-error" role="alert">
          {error}
        </p>
      )}

      <button className="st-primary" type="submit" disabled={busy || !ready}>
        {busy ? "Saving…" : "Add to the register"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";

// Step five: what this app is, in four screens, then you are in.
//
// THE CARDS DESCRIBE WHAT EXISTS. The brief for this step named an
// academy with quizzes and PDF certificates, a bulletin board, and a
// document vault. None of the three are built. Putting them in front of
// somebody on their first morning would send a new hire hunting the nav
// for an Academy tab that is not there, which is a worse first
// impression than a shorter tour — and it is the same mistake as a
// homepage advertising a feature the product has not shipped, made at
// the one moment a person is deciding whether to trust the tool.
//
// If those modules get built, they get a card each. Not before.

interface Card {
  title: string;
  body: string;
  /** The one thing to remember, in the person's own terms. */
  point: string;
}

const CARDS: Card[] = [
  {
    title: "Logs",
    body: "The daily checks your job owns — the fridge, the crash cart, the drawer. Each one is a short form on your phone, and it takes about fifteen seconds.",
    point:
      "You only see your job's logs. What you can't see belongs to someone else, and theirs doesn't show you.",
  },
  {
    title: "Rounds",
    body: "Walks with a fixed order, like the hourly lobby check. One step on screen at a time, and you sign once at the end.",
    point:
      "Found something wrong? Report it on that step and keep going. That note is the part your manager reads.",
  },
  {
    title: "Rules",
    body: "What your job may do and what it may never do, side by side, with the sentence to say when a patient asks you for the second kind.",
    point:
      "Nothing is recorded from this screen. It is there so you never have to guess in front of a patient.",
  },
  {
    title: "The record",
    body: "Everything you submit is timestamped and signed as you. Entries can't be backdated and a signed one can't be quietly edited.",
    point:
      "Never type a patient's name, date of birth, or anything identifying into this app. Describe the room, the cart, or the reading.",
  },
];

export default function Orientation() {
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const card = CARDS[at];
  const last = at === CARDS.length - 1;

  async function finish() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/staff/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "orientation" }),
    }).catch(() => null);

    if (!res?.ok) {
      setBusy(false);
      setError("That didn't save. Try again.");
      return;
    }
    // A role that requires a second factor gets it enforced starting now
    // — the server tells us where, so the redirect always matches
    // whatever session it just minted.
    const data = await res.json().catch(() => null);
    window.location.assign(data?.next ?? "/staff");
  }

  return (
    <div className="st-run">
      <div className="st-run-progress" aria-hidden="true">
        <span
          className="st-run-progress-fill"
          style={{ width: `${((at + 1) / CARDS.length) * 100}%` }}
        />
      </div>
      <p className="st-run-count">
        {at + 1} of {CARDS.length}
      </p>

      <h2 className="st-run-instruction">{card.title}</h2>
      <p className="st-run-detail">{card.body}</p>
      <p className="st-run-attest">{card.point}</p>

      {error && (
        <p className="st-run-error" role="alert">
          {error}
        </p>
      )}

      <div className="st-run-actions">
        {at > 0 && (
          <button className="st-btn" onClick={() => setAt((n) => n - 1)}>
            Back
          </button>
        )}
        {last ? (
          <button
            className="st-btn st-btn-primary"
            onClick={finish}
            disabled={busy}
          >
            {busy ? "Finishing…" : "Start work"}
          </button>
        ) : (
          <button
            className="st-btn st-btn-primary"
            onClick={() => setAt((n) => n + 1)}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

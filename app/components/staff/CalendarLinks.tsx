"use client";

import { useState } from "react";
import type { CalendarAccessRow } from "@/lib/staff/obligation-calendar";

// Issue a calendar subscription link for one obligation, and see who has
// been given one. Same shape as SurveyorLinks.tsx, minus an expiry
// window — a calendar subscription is meant to keep working until
// somebody revokes it, not close itself on a clock.

const ERRORS: Record<string, string> = {
  label_required: "Say who it's for — that's what the access list records.",
  forbidden: "Only a manager or administrator can issue calendar links.",
  not_found: "This obligation no longer exists.",
};

export default function CalendarLinks({
  obligationId,
  links,
}: {
  obligationId: string;
  links: CalendarAccessRow[];
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    if (label.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/staff/obligations/${obligationId}/calendar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: label.trim() }),
    }).catch(() => null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(ERRORS[body?.error] ?? "That didn't work. Try once more.");
      setBusy(false);
      return;
    }
    const data = await res.json();
    setIssued(data.url);
    setBusy(false);
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/staff/obligations/${obligationId}/calendar?id=${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (res?.ok) window.location.reload();
  }

  async function copy() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued).catch(() => null);
    setCopied(true);
  }

  if (issued) {
    return (
      <div className="st-sign">
        <div className="st-notice" role="status">
          <strong>Copy this now</strong>
          <span>
            It is shown once and cannot be retrieved afterwards &mdash; only a
            hash of it is stored. Paste it into &ldquo;subscribe by
            URL&rdquo; in Google Calendar, Outlook, or Apple Calendar. If you
            lose it, issue another; it takes one press.
          </span>
        </div>

        <div className="st-sv-link">
          <code>{issued}</code>
        </div>

        <div className="st-run-actions">
          <button className="st-btn" onClick={() => window.location.reload()}>
            Done
          </button>
          <button className="st-btn st-btn-primary" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="st-sign">
        <label className="st-field">
          <span className="st-field-label">Who is it for</span>
          <input
            className="st-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Front desk MA"
          />
          <span className="st-field-hint">
            Recorded against the link, same as an inspection link &mdash; this
            is what tells you later who has this clinic&rsquo;s schedule.
          </span>
        </label>

        {error && (
          <p className="st-run-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="st-primary"
          onClick={issue}
          disabled={label.trim().length < 3 || busy}
        >
          {busy ? "Issuing…" : "Issue calendar link"}
        </button>
      </div>

      {links.length > 0 && (
        <section className="st-section">
          <h2 className="st-h2">Links issued</h2>
          <div className="st-round-list">
            {links.map((l) => (
              <article key={l.id} className="st-round">
                <span className="st-round-main">
                  <span className="st-round-title">{l.label}</span>
                  <span className="st-round-purpose">
                    Issued by {l.created_by_name ?? "an administrator"}
                    {l.fetch_count > 0
                      ? ` · synced ${l.fetch_count} ${l.fetch_count === 1 ? "time" : "times"}`
                      : " · never synced"}
                  </span>
                </span>
                <span className="st-round-meta">
                  <span className={`st-tag st-tag-${l.state}`}>{l.state}</span>
                  {l.state !== "revoked" && (
                    <button
                      className="st-btn st-btn-quiet"
                      onClick={() => revoke(l.id)}
                    >
                      Revoke now
                    </button>
                  )}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import type { AccessRow } from "@/lib/staff/surveyor";

// Issue an inspection link, and see who has been given one.
//
// THE TOKEN IS SHOWN ONCE AND THEN NEVER AGAIN, because only its hash is
// stored. The UI says so before the link is generated rather than after,
// so nobody closes the dialog expecting to find it again later.
//
// The realistic scene: an inspector is standing at the desk. So the
// default is 48 hours, the label field is pre-filled with something
// plausible, and issuing is one press followed by one copy.

const WINDOWS = [
  { hours: 24, label: "24 hours" },
  { hours: 48, label: "48 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

const ERRORS: Record<string, string> = {
  label_required: "Say who it's for — that's what the audit trail records.",
  bad_window: "Pick one of the windows.",
  forbidden: "Only administrators can issue inspection links.",
};

export default function SurveyorLinks({ links }: { links: AccessRow[] }) {
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState(48);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  async function issue() {
    if (label.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/staff/surveyor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: label.trim(), hours }),
    }).catch(() => null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(ERRORS[body?.error] ?? "That didn't work. Try once more.");
      setBusy(false);
      return;
    }
    const data = await res.json();
    setIssued({ url: data.url, expiresAt: data.expiresAt });
    setBusy(false);
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/staff/surveyor?id=${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (res?.ok) window.location.reload();
  }

  async function copy() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.url).catch(() => null);
    setCopied(true);
  }

  if (issued) {
    return (
      <div className="st-sign">
        <div className="st-notice" role="status">
          <strong>Copy this now</strong>
          <span>
            It is shown once and cannot be retrieved afterwards &mdash; only a
            hash of it is stored. If you lose it, issue another; it takes one
            press.
          </span>
        </div>

        <div className="st-sv-link">
          <code>{issued.url}</code>
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
            placeholder="PA DOH, unannounced visit"
          />
          <span className="st-field-hint">
            Recorded against the link. This is what tells you later who was
            given access, and when.
          </span>
        </label>

        <label className="st-field">
          <span className="st-field-label">Expires after</span>
          <select
            className="st-input"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            {WINDOWS.map((w) => (
              <option key={w.hours} value={w.hours}>
                {w.label}
              </option>
            ))}
          </select>
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
          {busy ? "Issuing…" : "Issue inspection link"}
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
                    {l.view_count > 0
                      ? ` · opened ${l.view_count} ${l.view_count === 1 ? "time" : "times"}`
                      : " · never opened"}
                  </span>
                </span>
                <span className="st-round-meta">
                  <span className={`st-tag st-tag-${l.state}`}>{l.state}</span>
                  <span className="st-round-last">
                    {l.state === "active" || l.state === "unopened"
                      ? `Expires ${l.expires_at.slice(0, 16).replace("T", " ")}`
                      : l.revoked_at
                        ? "Revoked"
                        : "Expired"}
                  </span>
                  {(l.state === "active" || l.state === "unopened") && (
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

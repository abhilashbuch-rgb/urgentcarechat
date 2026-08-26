"use client";

import { useState } from "react";

// The other way to get the binder out of the building: typed straight
// to an inbox instead of downloaded and attached by hand. Same PDF as
// the download link beside this — see app/api/staff/accreditation/email/route.ts,
// which renders it exactly the same way and only changes the last step.

export default function EmailBinderForm() {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"sent" | "error" | "not_configured" | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !to.trim()) return;
    setBusy(true);
    setResult(null);

    const res = await fetch("/api/staff/accreditation/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: to.trim(), days: 90 }),
    }).catch(() => null);

    setBusy(false);
    if (res?.ok) {
      setResult("sent");
      setTo("");
      return;
    }
    setResult(res?.status === 503 ? "not_configured" : "error");
  }

  return (
    <form className="st-email-binder" onSubmit={submit}>
      <label className="st-field">
        <span className="st-field-label">Email the binder instead</span>
        <div className="st-email-binder-row">
          <input
            className="st-input"
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="anyone@anywhere.com"
            autoComplete="email"
          />
          <button className="st-secondary" type="submit" disabled={busy || !to.trim()}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
        <span className="st-field-hint">
          Same PDF as the download above, sent as an attachment — a
          corporate office, an accreditor, a broker, wherever it needs to
          go.
        </span>
      </label>

      {result === "sent" && (
        <p className="st-sign-ok" role="status">
          Sent.
        </p>
      )}
      {result === "error" && (
        <p className="st-sign-error" role="alert">
          That didn&rsquo;t go through. Try again, or use the download
          above and attach it yourself.
        </p>
      )}
      {result === "not_configured" && (
        <p className="st-sign-error" role="alert">
          Email sending isn&rsquo;t set up on this deployment yet &mdash;
          use the download above for now.
        </p>
      )}
    </form>
  );
}

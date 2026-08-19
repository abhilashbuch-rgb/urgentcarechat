"use client";

import { useState } from "react";
import { contactMailto } from "@/lib/site";

// Two fields, because two is what it takes. Asking for a phone number or
// a clinic size here would cost more signups than the data is worth.

export default function TrialForm() {
  const [clinic, setClinic] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/trial", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clinic: clinic.trim(), email: email.trim() }),
    }).catch(() => null);

    if (!res?.ok) {
      setBusy(false);
      setError(
        res?.status === 400
          ? "Check the clinic name and email address."
          : res?.status === 503
            // Not the visitor's fault, and saying "try again" would send
            // them round a loop that cannot succeed. Name the situation
            // and give them a way to reach a person.
            ? "notopen"
            : "That didn't go through. Try again."
      );
      return;
    }
    setDone(email.trim());
  }

  if (done) {
    return (
      <div className="tr-done">
        <h2>Your workspace is ready.</h2>
        <p>
          Sign in as <strong>{done}</strong> &mdash; with Google if that
          address is on Google Workspace, or with the emailed six-digit code
          otherwise. That address is the administrator; any other account
          will be turned away.
        </p>
        <a className="lp-btn-primary" href="/staff/signin">
          Sign in and set it up
        </a>
        <p className="tr-fine">
          14 days, no card. When it ends nothing is deleted — the workspace
          goes read-only and everything stays exportable.
        </p>
      </div>
    );
  }

  return (
    <form className="tr-form" onSubmit={submit}>
      <label className="st-field">
        <span className="st-field-label">Clinic name</span>
        <input
          className="st-input"
          value={clinic}
          onChange={(e) => setClinic(e.target.value)}
          placeholder="e.g. Riverside Urgent Care"
          autoFocus
        />
      </label>
      <label className="st-field">
        <span className="st-field-label">Your work email</span>
        <input
          className="st-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@clinic.com"
          autoComplete="email"
        />
        <span className="st-field-hint">
          You&rsquo;ll sign in as this address afterward &mdash; with Google
          if it&rsquo;s on Google Workspace, or with an emailed code if not.
          Microsoft 365 and any other mailbox work.
        </span>
      </label>

      {error === "notopen" ? (
        <p className="st-sign-error" role="alert">
          Self-serve signup isn&rsquo;t switched on yet &mdash; that&rsquo;s on
          us, not you.{" "}
          <a href={contactMailto("Set up my clinic")}>
            Email us and we&rsquo;ll set your clinic up by hand.
          </a>
        </p>
      ) : (
        error && (
          <p className="st-sign-error" role="alert">
            {error}
          </p>
        )
      )}

      <button className="st-primary" type="submit" disabled={busy}>
        {busy ? "Setting up…" : "Start the 14-day trial"}
      </button>
      <p className="tr-fine">No credit card. Nothing to cancel.</p>
    </form>
  );
}

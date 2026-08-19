"use client";

import { useState } from "react";

// Sign in with a code sent to your work email.
//
// FOR EVERY CLINIC THAT IS NOT ON GOOGLE WORKSPACE. Google stays the
// better door where it exists — it brings the clinic's own hardware
// keys, device checks and session revocation for free. This is the door
// for everyone else, and without it the product cannot be sold to a
// practice on Microsoft 365 at all.
//
// TWO STEPS ON ONE SCREEN, not two pages. The address stays visible
// while the code is typed, because the commonest failure is realising
// you sent it to the wrong address and having no way to see which one
// you used.

const ERRORS: Record<string, string> = {
  bad_email: "That doesn't look like an email address.",
  not_open_yet:
    "Sign-in isn't switched on for this deployment yet. Ask your administrator.",
  email_not_enabled:
    "Email sign-in isn't configured on this deployment yet. Ask your administrator, or use Google if your clinic has it.",
  // invalid and expired deliberately share a sentence — see the verify
  // route. Telling somebody a code "expired" confirms it was once real.
  invalid: "That code didn't work. Check it, or send a new one.",
  expired: "That code didn't work. Check it, or send a new one.",
  too_many: "Too many attempts on that code. Send a fresh one.",
  no_invite:
    "That address hasn't been invited to a clinic here. Ask your administrator to add it.",
  deactivated: "That account has been deactivated.",
};

export default function EmailSignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    if (busy) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/staff/auth/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(ERRORS[body?.error] ?? "That didn't send. Try once more.");
      setBusy(false);
      return;
    }
    setSent(true);
    setBusy(false);
  }

  async function verify() {
    if (busy || code.replace(/\D/g, "").length !== 6) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/staff/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), code: code.replace(/\D/g, "") }),
    }).catch(() => null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(ERRORS[body?.error] ?? "That didn't work. Try once more.");
      setBusy(false);
      return;
    }
    const body = await res.json();
    window.location.assign(body.next ?? "/staff");
  }

  return (
    <div className="st-email-auth">
      <label className="st-field">
        <span className="st-field-label">Work email</span>
        <input
          className="st-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={sent}
          placeholder="you@yourclinic.com"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !sent) requestCode();
          }}
        />
      </label>

      {sent && (
        <>
          <label className="st-field">
            <span className="st-field-label">Six-digit code</span>
            <input
              className="st-input st-code"
              // A numeric keypad on a phone, and no autocorrect turning
              // digits into something else.
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") verify();
              }}
            />
            <span className="st-field-hint">
              Sent to {email.trim()}. It expires in ten minutes. The email also
              has a link, if you are reading it on this device.
            </span>
          </label>
        </>
      )}

      {error && (
        <p className="st-run-error" role="alert">
          {error}
        </p>
      )}

      {!sent ? (
        <button
          className="st-primary"
          onClick={requestCode}
          disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
        >
          {busy ? "Sending…" : "Email me a code"}
        </button>
      ) : (
        <>
          <button
            className="st-primary"
            onClick={verify}
            disabled={busy || code.length !== 6}
          >
            {busy ? "Checking…" : "Sign in"}
          </button>
          <button
            className="st-btn st-btn-quiet st-email-again"
            onClick={() => {
              setSent(false);
              setCode("");
              setError(null);
            }}
          >
            Use a different address
          </button>
        </>
      )}
    </div>
  );
}

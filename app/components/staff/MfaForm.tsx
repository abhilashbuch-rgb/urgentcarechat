"use client";

import { useEffect, useRef, useState } from "react";

// The six-digit challenge, and the enrolment that precedes it.
//
// One component for both because to the person standing there they are
// the same act — read the code, type the code. Enrolment just shows the
// QR above it first.

export default function MfaForm({
  mode,
  qrDataUri,
  secretDisplay,
}: {
  mode: "enroll" | "challenge";
  qrDataUri?: string;
  secretDisplay?: string;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(value: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/staff/mfa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verify", code: value }),
    }).catch(() => null);

    if (!res?.ok) {
      setBusy(false);
      setCode("");
      inputRef.current?.focus();
      setError(
        res?.status === 400
          ? "That code didn't match. Codes change every 30 seconds — wait for the next one and try that."
          : "Couldn't check that code. Try again."
      );
      return;
    }
    window.location.assign("/staff");
  }

  // Six digits is the whole input, so there is no reason to make anyone
  // press a button afterwards — submit the moment the sixth lands.
  function onChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !busy) submit(digits);
  }

  return (
    <div className="st-mfa">
      {mode === "enroll" && (
        <div className="st-mfa-enroll">
          <ol className="st-mfa-steps">
            <li>
              Open your authenticator app — Google Authenticator, Authy, 1Password,
              or whatever your phone already has.
            </li>
            <li>Scan this code.</li>
            <li>Type the six digits it shows.</li>
          </ol>

          {qrDataUri && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              className="st-mfa-qr"
              src={qrDataUri}
              alt="QR code for enrolling your authenticator app"
              width={200}
              height={200}
            />
          )}

          <details className="st-mfa-manual">
            <summary>Can&rsquo;t scan it?</summary>
            <p>Enter this key into the app by hand:</p>
            <code className="st-mfa-secret">{secretDisplay}</code>
          </details>
        </div>
      )}

      <label className="st-field">
        <span className="st-field-label">Six-digit code</span>
        <input
          ref={inputRef}
          className="st-input st-mfa-input"
          value={code}
          onChange={(e) => onChange(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          disabled={busy}
          aria-label="Six-digit authentication code"
        />
      </label>

      {error && (
        <p className="st-sign-error" role="alert">
          {error}
        </p>
      )}

      {busy && <p className="st-mfa-busy">Checking…</p>}
    </div>
  );
}

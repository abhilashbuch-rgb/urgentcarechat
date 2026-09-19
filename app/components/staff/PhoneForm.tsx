"use client";

import { useEffect, useRef, useState } from "react";

// Two steps, one component — same reasoning as MfaForm.tsx: to the
// person typing, entering a number and entering the code it sent are
// one act, not two separate screens to navigate between.

type Step = "number" | "code";

export default function PhoneForm({ currentPhone }: { currentPhone: string | null }) {
  const [step, setStep] = useState<Step>("number");
  const [phone, setPhone] = useState(currentPhone ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function requestCode(value: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/staff/phone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: value }),
    }).catch(() => null);
    setBusy(false);

    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      setError(
        body?.error === "invalid_phone"
          ? "That doesn't look like a valid number. Include the country code, e.g. +12155551234."
          : body?.error === "not_configured"
            ? "Texting isn't turned on for this clinic yet — ask an admin."
            : body?.error === "too_soon"
              ? "A code was just sent. Give it a minute before asking for another."
              : body?.error === "send_failed"
                ? "Couldn't send a text to that number. Double check it and try again."
                : "Couldn't send a code. Try again."
      );
      return;
    }
    setStep("code");
    setCooldown(60);
  }

  function onSubmitNumber(e: React.FormEvent) {
    e.preventDefault();
    requestCode(phone.trim());
  }

  async function submitCode(value: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/staff/phone/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: value }),
    }).catch(() => null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      setBusy(false);
      setCode("");
      inputRef.current?.focus();
      setError(
        body?.error === "expired"
          ? "That code expired. Send a new one."
          : body?.error === "too_many_attempts"
            ? "Too many wrong tries. Send a new code."
            : body?.error === "no_pending"
              ? "No code is waiting — send one first."
              : "That code didn't match. Try again."
      );
      return;
    }
    window.location.assign("/staff");
  }

  function onCodeChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !busy) submitCode(digits);
  }

  if (step === "number") {
    return (
      <form className="st-mfa" onSubmit={onSubmitNumber}>
        <label className="st-field">
          <span className="st-field-label">Your phone number</span>
          <input
            ref={inputRef}
            className="st-input"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+12155551234"
            disabled={busy}
            aria-label="Your phone number"
          />
        </label>
        <p className="st-field-hint">
          Include the country code, e.g. +1 for the US.
        </p>
        <button className="st-btn" type="submit" disabled={busy || phone.trim().length === 0}>
          {busy ? "Sending…" : "Send code"}
        </button>
        {error && (
          <p className="st-sign-error" role="alert">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="st-mfa">
      <p className="st-field-hint">
        We texted a six-digit code to {phone}.{" "}
        <button
          type="button"
          className="st-quiet"
          onClick={() => {
            setStep("number");
            setError(null);
          }}
        >
          Wrong number?
        </button>
      </p>
      <label className="st-field">
        <span className="st-field-label">Six-digit code</span>
        <input
          ref={inputRef}
          className="st-input st-mfa-input"
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          disabled={busy}
          aria-label="Six-digit verification code"
        />
      </label>
      {error && (
        <p className="st-sign-error" role="alert">
          {error}
        </p>
      )}
      {busy && <p className="st-mfa-busy">Checking…</p>}
      <button
        type="button"
        className="st-quiet"
        disabled={cooldown > 0}
        onClick={() => requestCode(phone.trim())}
      >
        {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
      </button>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { CredentialRequirement } from "@/lib/staff/onboarding";

// Step three: when your credentials expire.
//
// DATES ONLY. There is no field here for a licence number, an ARRT
// number, or a DEA registration, and there is no column in the database
// to put one in either. Every question this product answers — is anyone
// working expired, what expires in the next sixty days — is answerable
// from the date, and a number is worth stealing where a date is not.
//
// THE OPTIONAL ONES ARE SHOWN, NOT HIDDEN BEHIND A DISCLOSURE. Somebody
// filling this in has their wallet open, which is the cheapest moment
// there will ever be to capture ACLS as well as BLS. They can be left
// blank; only the required ones hold the step.

export default function CredentialDates({
  requirements,
}: {
  requirements: CredentialRequirement[];
}) {
  const [dates, setDates] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      requirements.map((r) => [r.kind, r.expires_on ?? ""])
    )
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = requirements.filter((r) => r.required && !dates[r.kind]);
  const ready = missing.length === 0 && !busy;

  // A date already in the past is almost always a typo — a year keyed as
  // last year — and it is worth catching at the field rather than
  // letting somebody onboard visibly expired.
  const today = new Date().toISOString().slice(0, 10);
  const expired = requirements.filter(
    (r) => dates[r.kind] && dates[r.kind] < today
  );

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/staff/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "credentials",
        dates: Object.entries(dates)
          .filter(([, v]) => v)
          .map(([kind, expires_on]) => ({ kind, expires_on })),
      }),
    }).catch(() => null);

    if (!res?.ok) {
      setBusy(false);
      setError("That didn't save. Try again — nothing was recorded.");
      return;
    }
    window.location.assign("/staff/onboarding");
  }

  return (
    <div className="st-sign">
      {requirements.map((r) => (
        <label className="st-field" key={r.kind}>
          <span className="st-field-label">
            {r.label}
            {!r.required && <span className="st-field-optional">Optional</span>}
          </span>
          <input
            className="st-input"
            type="date"
            value={dates[r.kind] ?? ""}
            onChange={(e) =>
              setDates((d) => ({ ...d, [r.kind]: e.target.value }))
            }
          />
          {r.hint && <span className="st-field-hint">{r.hint}</span>}
        </label>
      ))}

      {expired.length > 0 && (
        <div className="st-notice st-notice-warn" role="status">
          <strong>
            {expired.length === 1
              ? "That date has already passed"
              : "Those dates have already passed"}
          </strong>
          <span>
            Check the year. If it is right, enter it anyway — the roster will
            show it as expired, which is the truth and is what your manager
            needs to see.
          </span>
        </div>
      )}

      <p className="st-sign-fine">
        Dates only. This app never stores a licence, ARRT, or DEA number, so
        there is nothing here worth stealing.
      </p>

      {error && (
        <p className="st-run-error" role="alert">
          {error}
        </p>
      )}

      <button className="st-primary" onClick={submit} disabled={!ready}>
        {busy ? "Saving…" : "Save and continue"}
      </button>
      {missing.length > 0 && (
        <p className="st-sign-fine">
          {missing.map((m) => m.label.replace(/ expires$/, "")).join(", ")} is
          required before you can start.
        </p>
      )}
    </div>
  );
}

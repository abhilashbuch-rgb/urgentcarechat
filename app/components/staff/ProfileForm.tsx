"use client";

import { useState } from "react";

// Step one of onboarding: your legal name and your consent to sign
// electronically.
//
// The consent language is spelled out rather than buried behind a link,
// because "consented to electronic records" is only worth something as
// evidence if the person was actually shown what they were consenting to.

export default function ProfileForm({
  defaultLegalName,
  defaultJobTitle,
  orgName,
}: {
  defaultLegalName: string;
  defaultJobTitle: string;
  orgName: string;
}) {
  const [legalName, setLegalName] = useState(defaultLegalName);
  const [jobTitle, setJobTitle] = useState(defaultJobTitle);
  const [startDate, setStartDate] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = legalName.trim().length >= 2 && consent && !submitting;

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/staff/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        legalName: legalName.trim(),
        jobTitle: jobTitle.trim(),
        startDate: startDate || undefined,
        consent: true,
      }),
    }).catch(() => null);

    if (!res?.ok) {
      setSubmitting(false);
      setError("That didn't save. Try again — nothing was recorded.");
      return;
    }
    window.location.assign("/staff/onboarding");
  }

  return (
    <div className="st-sign">
      <label className="st-field">
        <span className="st-field-label">Your full legal name</span>
        <input
          className="st-input"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          placeholder="e.g. Kathryn A. Nguyen"
          autoComplete="name"
        />
        <span className="st-field-hint">
          As you would sign a document — not a nickname. This is the name that
          appears on everything you sign here.
        </span>
      </label>

      <label className="st-field">
        <span className="st-field-label">Your role at {orgName}</span>
        <input
          className="st-input"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="e.g. Medical Assistant"
        />
      </label>

      <label className="st-field">
        <span className="st-field-label">Start date (optional)</span>
        <input
          className="st-input st-input-date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </label>

      <div className="st-consent">
        <h3>Consent to electronic records and signatures</h3>
        <ul>
          <li>
            You agree to receive these policies electronically and to sign them
            with an electronic signature, which has the same effect as signing
            on paper.
          </li>
          <li>
            You can view and print your complete signed record at any time from
            this site, and ask an administrator for a paper copy.
          </li>
          <li>
            You need a device with a current web browser and the ability to
            print or save a PDF. If that stops being true, tell an
            administrator and they will arrange paper.
          </li>
          <li>
            You may withdraw this consent by telling an administrator. Doing so
            does not undo signatures you have already made.
          </li>
        </ul>
      </div>

      <label className="st-check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          I have read the statement above and I consent to receiving and signing
          these records electronically.
        </span>
      </label>

      {error && (
        <p className="st-sign-error" role="alert">
          {error}
        </p>
      )}

      <button className="st-primary" onClick={submit} disabled={!ready}>
        {submitting ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Context {
  providerName: string;
  patientFirstName: string;
  patientLastName: string;
  patientDob: string;
  symptomSummary: string | null;
}

function NoteForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [context, setContext] = useState<Context | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [diagnosisCode, setDiagnosisCode] = useState("");
  const [procedureCode, setProcedureCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/telehealth/note?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) {
          setLoadError(data.error || "This link is invalid or has expired.");
          return;
        }
        setContext(data);
      } catch {
        setLoadError("Something went wrong loading this visit.");
      }
    })();
  }, [token]);

  const submit = async () => {
    if (!token || note.trim().length < 5) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/telehealth/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, note, diagnosisCode, procedureCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  if (!token) {
    return <div className="lux-card"><p className="lux-card-sub">Missing link token.</p></div>;
  }

  if (loadError) {
    return <div className="lux-card"><p className="lux-card-sub">{loadError}</p></div>;
  }

  if (submitted) {
    return (
      <div className="lux-card">
        <h1 className="lux-card-title">Note submitted</h1>
        <p className="lux-card-sub">
          Thanks — this has been sent to the patient&apos;s medical record.
          {diagnosisCode.trim() && procedureCode.trim() && (
            " We've also texted the patient a receipt they can submit to their own insurance."
          )}
        </p>
      </div>
    );
  }

  if (!context) {
    return <div className="lux-card lux-loading">Loading visit details…</div>;
  }

  return (
    <div className="lux-card">
      <h1 className="lux-card-title">Document this visit</h1>
      <p className="lux-card-sub">
        {context.patientFirstName} {context.patientLastName} · DOB {context.patientDob}
      </p>
      {context.symptomSummary && (
        <p className="lux-card-sub" style={{ fontStyle: "italic" }}>
          Reported: &quot;{context.symptomSummary}&quot;
        </p>
      )}

      <textarea
        className="lux-textarea"
        placeholder="Visit note — chief complaint, assessment, plan…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={8}
        aria-label="Visit note"
      />

      <p className="lux-card-sub" style={{ marginTop: 4 }}>
        Optional — add a diagnosis and procedure code to give the patient an
        insurance receipt they can submit themselves for reimbursement.
      </p>
      <div className="lux-input-row">
        <input
          className="lux-input"
          placeholder="Diagnosis code (ICD-10), e.g. J06.9"
          value={diagnosisCode}
          onChange={(e) => setDiagnosisCode(e.target.value)}
          aria-label="Diagnosis code"
        />
        <input
          className="lux-input"
          placeholder="Procedure code (CPT), e.g. 99442"
          value={procedureCode}
          onChange={(e) => setProcedureCode(e.target.value)}
          aria-label="Procedure code"
        />
      </div>

      {submitError && <div className="telehealth-error">{submitError}</div>}

      <button className="lux-btn" onClick={submit} disabled={submitting || note.trim().length < 5}>
        {submitting ? "Submitting…" : "Submit note"}
      </button>
    </div>
  );
}

export default function ProviderNotePage() {
  return (
    <div className="lux-shell">
      <header className="lux-header">
        <div className="brand lux-brand">
          <span className="dot"></span>urgentcare
          <span className="tld">.chat</span>
        </div>
        <div className="lux-tagline">Provider</div>
      </header>

      <main className="lux-main" style={{ maxWidth: 480 }}>
        <Suspense fallback={<div className="lux-card lux-loading">Loading…</div>}>
          <NoteForm />
        </Suspense>
      </main>
    </div>
  );
}

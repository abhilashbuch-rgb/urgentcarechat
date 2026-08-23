"use client";

import { useState } from "react";

// Same five archetypes as the trial signup (TrialForm.tsx) and the demo
// wizard — one vocabulary for "what kind of clinic" everywhere it's
// asked, so a returning owner isn't relearning a second picker.
const FACILITIES: { id: string; label: string }[] = [
  { id: "urgent_care", label: "Urgent care" },
  { id: "primary_care", label: "Primary care or pediatrics" },
  { id: "med_spa", label: "Medical spa" },
  { id: "ambulatory_surgery", label: "Surgery center" },
  { id: "dental", label: "Dental or oral surgery" },
];

export default function AddClinicForm() {
  const [name, setName] = useState("");
  const [facility, setFacility] = useState("urgent_care");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/staff/clinics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), facility }),
    }).catch(() => null);

    if (!res?.ok) {
      setBusy(false);
      setError(
        res?.status === 403
          ? "Only an administrator can add a clinic."
          : "That didn't go through. Try again."
      );
      return;
    }
    // The new clinic shows up in the list above on reload — simplest
    // correct thing, and this form isn't submitted often enough for a
    // full-page reload to matter.
    window.location.reload();
  }

  return (
    <form className="st-log" onSubmit={submit}>
      <label className="st-field">
        <span className="st-field-label">Clinic name</span>
        <input
          className="st-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Riverside Urgent Care"
        />
      </label>

      <label className="st-field">
        <span className="st-field-label">What kind of clinic</span>
        <select
          className="st-input"
          value={facility}
          onChange={(e) => setFacility(e.target.value)}
        >
          {FACILITIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="st-sign-error" role="alert">
          {error}
        </p>
      )}

      <button className="st-primary" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add this clinic"}
      </button>
    </form>
  );
}

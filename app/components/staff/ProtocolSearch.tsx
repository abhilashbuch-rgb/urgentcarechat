"use client";

import { useState } from "react";
import type { ProtocolHit } from "@/lib/staff/protocols";

// The search box, and the passages it finds.
//
// RESULTS ARE PRINTED VERBATIM AND ATTRIBUTED. No summary, no synthesis,
// no "based on the above". The clinician reads the paragraph somebody
// wrote and the line under it saying who wrote it and when — which is
// the same thing the binder on the shelf does, only findable.
//
// EVERY RESULT CARRIES ITS AGE AND ITS REVIEW STATE. A guideline from
// 2019 shown without its year is a guideline shown as current, and a
// protocol nobody local has reviewed is labelled as such rather than
// hidden — hiding it would mean the search quietly missed the document
// the clinic actually uses.

export default function ProtocolSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProtocolHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query.length < 2) return;
    setBusy(true);
    setError(null);

    const res = await fetch(
      `/api/staff/protocols?q=${encodeURIComponent(query)}`
    ).catch(() => null);

    if (!res?.ok) {
      setError("That search didn't run. Try once more.");
      setBusy(false);
      return;
    }
    const body = await res.json();
    setHits(body.hits ?? []);
    setBusy(false);
  }

  return (
    <>
      <form className="st-protocol-search" onSubmit={run}>
        <input
          className="st-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="tetanus timing contaminated wound"
          aria-label="Search protocols"
        />
        <button className="st-btn st-btn-primary" type="submit" disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>

      <p className="st-field-hint">
        Plain words work. Put a phrase in quotes to match it exactly. Never
        type a patient&rsquo;s name, date of birth, or anything identifying.
      </p>

      {error && (
        <p className="st-run-error" role="alert">
          {error}
        </p>
      )}

      {hits !== null && hits.length === 0 && (
        <div className="st-notice" role="status">
          <strong>Nothing matched</strong>
          <span>
            Try fewer words, or different ones. Searches that find nothing are
            logged without your wording being kept, so your clinic can see
            which protocols it hasn&rsquo;t written down yet.
          </span>
        </div>
      )}

      {hits !== null && hits.length > 0 && (
        <div className="st-protocol-hits">
          {hits.map((h) => (
            <article key={h.section_id} className="st-protocol-hit">
              <h2 className="st-protocol-heading">
                {h.heading ?? h.title}
              </h2>
              <p className="st-protocol-body">{h.body}</p>
              <p className="st-protocol-cite">
                <span>{h.title}</span>
                <span>{h.source}</span>
                {h.protocol_code && <span>{h.protocol_code}</span>}
                {h.source_date && (
                  <span>{h.source_date.slice(0, 4)}</span>
                )}
                <span
                  className={
                    h.reviewed_on
                      ? "st-protocol-reviewed"
                      : "st-protocol-unreviewed"
                  }
                >
                  {h.reviewed_on
                    ? `Reviewed here ${h.reviewed_on}`
                    : "Not reviewed by your medical director"}
                </span>
              </p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

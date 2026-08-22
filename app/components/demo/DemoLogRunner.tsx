"use client";

import { useState } from "react";

// The same one-tap chips as the real shift log
// (app/components/staff/LogForm.tsx), reimplemented rather than reused.
// The real component's submit() posts to /api/staff/logs/submit, and a
// demo visitor has no session for that route to accept — importing it
// here and hoping the fetch fails harmlessly is exactly the kind of
// silent-failure UX this product's real forms go out of their way to
// avoid. This version never calls fetch at all.
//
// THE CORRECTIVE ACTION IS REAL HERE, AND IT DID NOT USED TO BE.
// This screen previously printed a paragraph explaining that an
// out-of-range reading requires twenty characters of corrective action
// and that "n/a" is rejected — and then let you file anyway, because
// "that field is skipped here since nothing is actually being filed".
//
// That was the wrong thing to skip. The gate is the product's entire
// argument: a binder full of readings nobody acted on is what a surveyor
// finds, and the whole point is that this software will not let you
// create one. An evaluator who reads about it is unconvinced; an
// evaluator who taps 52 degF, tries to type "n/a", and is refused has
// understood the product. So it is enforced, on the same rules as the
// real route.

const FRIDGE_PRESETS = [37.8, 38.0, 38.2, 38.4, 38.6];
const O2_PRESETS = [2000, 1800, 1500];
const MIN_CORRECTIVE = 20;

/** Rejected outright however long the field is. Mirrors
 *  supabase/staff-corrective-action.sql — three characters used to be
 *  the only bar, and "n/a" cleared it. */
const TOKENS = new Set([
  "n/a", "na", "none", "nothing", "ok", "okay", "fine", "done",
  "no action", "no action taken", "n/a.", "-", "--",
]);

interface Check {
  slug: string;
  name: string;
  slot: string | null;
}

export default function DemoLogRunner({
  check,
  onFiled,
  onCancel,
}: {
  check: Check;
  onFiled: (flagged: boolean) => void;
  onCancel: () => void;
}) {
  const [fridgeTemp, setFridgeTemp] = useState<number | null>(38.0);
  const [o2Psi, setO2Psi] = useState<number | null>(2000);
  const [sealIntact, setSealIntact] = useState<boolean | null>(null);
  const [corrective, setCorrective] = useState("");
  const [refused, setRefused] = useState<string | null>(null);

  const fridgeOut = fridgeTemp !== null && (fridgeTemp < 36 || fridgeTemp > 46);
  const o2Out = o2Psi !== null && o2Psi < 1000;
  const flagged = fridgeOut || o2Out;

  const trimmed = corrective.trim();

  function submit() {
    if (sealIntact === null) return;
    if (!flagged) return onFiled(false);

    if (TOKENS.has(trimmed.toLowerCase())) {
      setRefused(
        "That is one of the answers this field exists to catch. A reading of 52 °F with “n/a” beside it is worse than no note at all — it reads as a complete record, so nobody chases it."
      );
      return;
    }
    if (trimmed.length < MIN_CORRECTIVE) {
      setRefused(
        `Twenty characters, not three. Say what you did about it: moved the stock, called the manufacturer, tagged the unit. You have written ${trimmed.length}.`
      );
      return;
    }
    onFiled(true);
  }

  return (
    <div className="st-log">
      <div className="st-log-by">
        <span>Dana Whitfield</span>
        <span>Today</span>
        {check.slot && <span className="st-log-slot">{check.slot}</span>}
      </div>

      <h2 className="st-h2">{check.name}</h2>

      <p className="st-log-standard">
        Vaccine storage 36&ndash;46 &deg;F. Both O2 cylinders above 1000 PSI.
      </p>

      <div className="st-log-fields">
        <div className={`st-log-row${fridgeOut ? " st-log-row-flag" : ""}`}>
          <div className="st-log-label">
            <span>Vaccine fridge &mdash; current</span>
            <span className="st-log-range">36&ndash;46 °F</span>
          </div>
          <div className="st-log-input">
            <div className="st-preset-row" role="group" aria-label="Vaccine fridge presets">
              {FRIDGE_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`st-preset-chip${fridgeTemp === p ? " st-preset-on" : ""}`}
                  onClick={() => { setFridgeTemp(p); setRefused(null); }}
                >
                  {p.toFixed(1)}°F
                </button>
              ))}
              <button
                type="button"
                className={`st-preset-chip${fridgeOut ? " st-preset-on" : ""}`}
                onClick={() => { setFridgeTemp(52); setRefused(null); }}
              >
                Out of range / other
              </button>
            </div>
          </div>
        </div>

        <div className={`st-log-row${o2Out ? " st-log-row-flag" : ""}`}>
          <div className="st-log-label">
            <span>Primary O2 cylinder</span>
            <span className="st-log-range">&ge; 1000 PSI</span>
          </div>
          <div className="st-log-input">
            <div className="st-preset-row" role="group" aria-label="O2 cylinder presets">
              {O2_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`st-preset-chip${o2Psi === p ? " st-preset-on" : ""}`}
                  onClick={() => { setO2Psi(p); setRefused(null); }}
                >
                  {p} PSI
                </button>
              ))}
              <button
                type="button"
                className={`st-preset-chip${o2Out ? " st-preset-on" : ""}`}
                onClick={() => { setO2Psi(600); setRefused(null); }}
              >
                Out of range / low
              </button>
            </div>
          </div>
        </div>

        <div className="st-log-row">
          <div className="st-log-label">
            <span>Breakaway seal intact</span>
          </div>
          <div className="st-log-input">
            <div className="st-toggle" role="group" aria-label="Breakaway seal intact">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  className={`st-toggle-btn${sealIntact === v ? " st-toggle-on" : ""}`}
                  aria-pressed={sealIntact === v}
                  onClick={() => setSealIntact(v)}
                >
                  {v ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {flagged && (
        <div className="st-log-alert" role="alert">
          <strong>Out of range</strong>
          <p>
            This cannot be filed as a number alone. Say what you did about
            it &mdash; the reading and the response are one record, and a
            reading with no response is what a surveyor finds three years
            later.
          </p>
          <textarea
            className="st-input st-textarea"
            rows={3}
            value={corrective}
            onChange={(e) => { setCorrective(e.target.value); setRefused(null); }}
            placeholder="Moved stock to the backup unit, tagged DO NOT USE, called the vaccine programme for a viability decision."
            aria-label="Corrective action taken"
          />
          {refused && <p className="st-log-refused">{refused}</p>}
        </div>
      )}

      <button
        className={`st-primary${flagged ? " st-primary-warn" : ""}`}
        type="button"
        disabled={sealIntact === null}
        onClick={submit}
      >
        {sealIntact === null
          ? "Answer the seal question to file"
          : flagged
            ? "File with corrective action"
            : "File this check"}
      </button>

      {/* Only a length hint, and only when length is the problem. Showing
          "17 more characters" beside a refusal that was about the WORDS
          invites somebody to pad "n/a" out to twenty. */}
      {flagged &&
        !refused &&
        trimmed.length > 0 &&
        trimmed.length < MIN_CORRECTIVE && (
          <p className="st-field-hint">
            {MIN_CORRECTIVE - trimmed.length} more characters.
          </p>
        )}

      <button className="st-btn st-log-back" type="button" onClick={onCancel}>
        Back to Today
      </button>
    </div>
  );
}

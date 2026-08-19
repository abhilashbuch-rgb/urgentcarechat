"use client";

import { useState } from "react";

// The same one-tap chips as the real shift log
// (app/components/staff/LogForm.tsx), reimplemented rather than reused.
// The real component's submit() posts to /api/staff/logs/submit, and a
// demo visitor has no session for that route to accept — importing it
// here and hoping the fetch fails harmlessly is exactly the kind of
// silent-failure UX this product's real forms go out of their way to
// avoid. This version never calls fetch at all; "Submit" only ever sets
// local state.

const FRIDGE_PRESETS = [37.8, 38.0, 38.2, 38.4, 38.6];
const O2_PRESETS = [2000, 1800, 1500];

export default function DemoLogRunner() {
  const [fridgeTemp, setFridgeTemp] = useState<number | null>(38.0);
  const [o2Psi, setO2Psi] = useState<number | null>(2000);
  const [sealIntact, setSealIntact] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const flagged =
    (fridgeTemp !== null && (fridgeTemp < 36 || fridgeTemp > 46)) ||
    (o2Psi !== null && o2Psi < 1000);

  if (submitted) {
    return (
      <div className="st-log demo-log-done">
        <strong>Logged &mdash; in a real shift, this is filed and dated.</strong>
        <p>
          Nothing was actually saved; this is a demo. On a real clinic this
          submission would be timestamped, signed to your account, and
          visible on the surveyor vault within the same shift.
        </p>
        <button className="st-primary" type="button" onClick={() => setSubmitted(false)}>
          Run it again
        </button>
      </div>
    );
  }

  return (
    <div className="st-log">
      <div className="st-log-by">
        <span>Demo, Medical Assistant</span>
        <span>Today</span>
        <span className="st-log-slot">AM</span>
      </div>

      <p className="st-log-standard">
        Vaccine storage 36&ndash;46 &deg;F. Both O2 cylinders above 1000 PSI.
      </p>

      <div className="st-log-fields">
        <div className={`st-log-row${fridgeTemp !== null && (fridgeTemp < 36 || fridgeTemp > 46) ? " st-log-row-flag" : ""}`}>
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
                  onClick={() => setFridgeTemp(p)}
                >
                  {p.toFixed(1)}°F
                </button>
              ))}
              <button
                type="button"
                className={`st-preset-chip${fridgeTemp !== null && !FRIDGE_PRESETS.includes(fridgeTemp) ? " st-preset-on" : ""}`}
                onClick={() => setFridgeTemp(52)}
              >
                Out of range / other
              </button>
            </div>
          </div>
        </div>

        <div className={`st-log-row${o2Psi !== null && o2Psi < 1000 ? " st-log-row-flag" : ""}`}>
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
                  onClick={() => setO2Psi(p)}
                >
                  {p} PSI
                </button>
              ))}
              <button
                type="button"
                className={`st-preset-chip${o2Psi !== null && !O2_PRESETS.includes(o2Psi) ? " st-preset-on" : ""}`}
                onClick={() => setO2Psi(600)}
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
            On a real log this requires a corrective action of at least 20
            characters before it can be filed &mdash; a blank or a token
            &ldquo;n/a&rdquo; is rejected. That field is skipped here since
            nothing is actually being filed.
          </p>
        </div>
      )}

      <button
        className={`st-primary${flagged ? " st-primary-warn" : ""}`}
        type="button"
        disabled={sealIntact === null}
        onClick={() => setSubmitted(true)}
      >
        {flagged ? "Submit with corrective action" : "Submit log"}
      </button>
    </div>
  );
}

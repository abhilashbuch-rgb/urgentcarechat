"use client";

import { useState } from "react";
import Link from "next/link";

export default function TelehealthIntake() {
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [feeUnderstood, setFeeUnderstood] = useState(false);
  const [notEmergency, setNotEmergency] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = locationConfirmed && feeUnderstood && notEmergency && !loading;

  const handleConnect = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/telehealth/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateAttested: "PA" }),
      });
      const data = await res.json();

      if (!res.ok || !data.url) {
        setError(data.error || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <>
      <header className="site-header">
        <div className="brand">
          <span className="dot"></span>urgentcare
          <span className="tld">.chat</span>
        </div>
        <div className="tagline">Talk to a doctor now</div>
      </header>

      <main className="app">
        <div className="disclaimer">
          <strong>Not for emergencies.</strong> If this is a life-threatening
          emergency, call <strong>911</strong> immediately.
        </div>

        <div className="telehealth-card">
          <h1 className="telehealth-title">Connect with a doctor — $100</h1>
          <p className="telehealth-sub">
            A 30-minute live chat connection to a physician currently
            credentialed and licensed in Pennsylvania.
          </p>

          <ul className="telehealth-terms">
            <li>
              This is a <strong>technology/platform fee</strong> that
              connects you to the doctor. It is separate from, and does not
              include, the medical visit itself — the practice bills that
              portion separately and it is not processed by urgentcare.chat.
            </li>
            <li>
              This service is currently available only to patients
              physically located in <strong>Pennsylvania</strong>, since
              that is where the doctor is licensed to practice.
            </li>
            <li>
              The connection fee is non-refundable once the doctor has been
              notified and is available to connect.
            </li>
          </ul>

          <label className="telehealth-check">
            <input
              type="checkbox"
              checked={locationConfirmed}
              onChange={(e) => setLocationConfirmed(e.target.checked)}
            />
            <span>I confirm I am currently physically located in Pennsylvania.</span>
          </label>

          <label className="telehealth-check">
            <input
              type="checkbox"
              checked={feeUnderstood}
              onChange={(e) => setFeeUnderstood(e.target.checked)}
            />
            <span>
              I understand the $100 fee covers the platform/scheduling
              service only, and that the practice bills the medical visit
              separately.
            </span>
          </label>

          <label className="telehealth-check">
            <input
              type="checkbox"
              checked={notEmergency}
              onChange={(e) => setNotEmergency(e.target.checked)}
            />
            <span>
              This is not a medical emergency. If it were, I would call 911
              instead.
            </span>
          </label>

          {error && <div className="telehealth-error">{error}</div>}

          <button
            className="telehealth-btn"
            onClick={handleConnect}
            disabled={!canSubmit}
          >
            {loading ? "Starting checkout…" : "Pay $100 & connect"}
          </button>

          <Link className="telehealth-back" href="/">
            &larr; Back to chat
          </Link>
        </div>
      </main>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Provider {
  id: string;
  name: string;
  credentials: string | null;
  specialty: string | null;
  bio: string | null;
  photo_url: string | null;
  practice_name: string | null;
  platform_fee_cents: number;
}

function initials(name: string): string {
  return name
    .replace(/^Dr\.?\s*/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function DoctorAvatar({ provider }: { provider: Provider }) {
  if (provider.photo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="lux-avatar" src={provider.photo_url} alt={provider.name} />;
  }
  return <div className="lux-avatar lux-avatar-fallback">{initials(provider.name)}</div>;
}

export default function TelehealthIntake() {
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [feeUnderstood, setFeeUnderstood] = useState(false);
  const [notEmergency, setNotEmergency] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/telehealth/providers?state=PA");
        const data = await res.json();
        if (cancelled) return;
        const list: Provider[] = data.providers || [];
        setProviders(list);
        if (list.length === 1) setSelectedId(list[0].id);
      } catch {
        if (!cancelled) setProviders([]);
      } finally {
        if (!cancelled) setLoadingProviders(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = providers.find((p) => p.id === selectedId) || null;
  const canSubmit =
    !!selected && locationConfirmed && feeUnderstood && notEmergency && !loading;

  const handleConnect = async () => {
    if (!canSubmit || !selected) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/telehealth/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateAttested: "PA", providerId: selected.id }),
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

  const feeDollars = selected ? (selected.platform_fee_cents / 100).toFixed(0) : "100";

  return (
    <div className="lux-shell">
      <header className="lux-header">
        <div className="brand lux-brand">
          <span className="dot"></span>urgentcare
          <span className="tld">.chat</span>
        </div>
        <div className="lux-tagline">Concierge Care</div>
      </header>

      <main className="lux-main">
        <div className="lux-emergency-note">
          <strong>Not for emergencies.</strong> If this is life-threatening, call{" "}
          <strong>911</strong> now.
        </div>

        <h1 className="lux-title">Talk to a doctor, right now.</h1>
        <p className="lux-subtitle">
          A live 30-minute connection to a physician credentialed and licensed
          in Pennsylvania — no waiting room, no appointment three weeks out.
        </p>

        {loadingProviders && (
          <div className="lux-card lux-loading">Finding available doctors…</div>
        )}

        {!loadingProviders && providers.length === 0 && (
          <div className="lux-card">
            <p className="telehealth-sub" style={{ marginBottom: 0 }}>
              No doctors are currently available for Pennsylvania patients.
              Please check back soon, or use the chat to find a nearby urgent
              care instead.
            </p>
            <Link className="lux-back" href="/">
              &larr; Back to chat
            </Link>
          </div>
        )}

        {!loadingProviders && providers.length > 1 && (
          <div className="lux-doctor-grid">
            {providers.map((p) => (
              <button
                key={p.id}
                className={`lux-doctor-card${selectedId === p.id ? " selected" : ""}`}
                onClick={() => setSelectedId(p.id)}
              >
                <DoctorAvatar provider={p} />
                <div className="lux-doctor-name">
                  {p.name}
                  {p.credentials ? `, ${p.credentials}` : ""}
                </div>
                {p.specialty && <div className="lux-doctor-specialty">{p.specialty}</div>}
                {p.practice_name && <div className="lux-doctor-practice">{p.practice_name}</div>}
                {p.bio && <div className="lux-doctor-bio">{p.bio}</div>}
                <div className="lux-available-badge">
                  <span className="lux-pulse-dot"></span>Available
                </div>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="lux-card">
            {providers.length === 1 && (
              <div className="lux-doctor-summary">
                <DoctorAvatar provider={selected} />
                <div>
                  <div className="lux-doctor-name">
                    {selected.name}
                    {selected.credentials ? `, ${selected.credentials}` : ""}
                  </div>
                  {selected.specialty && (
                    <div className="lux-doctor-specialty">{selected.specialty}</div>
                  )}
                  {selected.practice_name && (
                    <div className="lux-doctor-practice">{selected.practice_name}</div>
                  )}
                </div>
              </div>
            )}

            <h2 className="lux-price">${feeDollars} · 30 minutes</h2>

            <ul className="lux-terms">
              <li>
                This is a <strong>technology/platform fee</strong> that connects
                you to the doctor. It is separate from, and does not include,
                the medical visit itself — the practice bills that portion
                separately and it is not processed by urgentcare.chat.
              </li>
              <li>
                Available only to patients physically located in{" "}
                <strong>Pennsylvania</strong>, where this doctor is licensed to
                practice.
              </li>
              <li>Non-refundable once the doctor has been notified and is available.</li>
            </ul>

            <label className="lux-check">
              <input
                type="checkbox"
                checked={locationConfirmed}
                onChange={(e) => setLocationConfirmed(e.target.checked)}
              />
              <span>I confirm I am currently physically located in Pennsylvania.</span>
            </label>

            <label className="lux-check">
              <input
                type="checkbox"
                checked={feeUnderstood}
                onChange={(e) => setFeeUnderstood(e.target.checked)}
              />
              <span>
                I understand this fee covers the platform/scheduling service
                only, and the practice bills the medical visit separately.
              </span>
            </label>

            <label className="lux-check">
              <input
                type="checkbox"
                checked={notEmergency}
                onChange={(e) => setNotEmergency(e.target.checked)}
              />
              <span>This is not a medical emergency. If it were, I would call 911 instead.</span>
            </label>

            {error && <div className="telehealth-error">{error}</div>}

            <button className="lux-btn" onClick={handleConnect} disabled={!canSubmit}>
              {loading ? "Starting checkout…" : `Pay $${feeDollars} & connect`}
            </button>
          </div>
        )}

        <Link className="lux-back" href="/">
          &larr; Back to chat
        </Link>
      </main>
    </div>
  );
}

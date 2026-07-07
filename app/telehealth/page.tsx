"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { checkRedFlags } from "@/lib/red-flags";

interface Provider {
  id: string;
  name: string;
  credentials: string | null;
  specialty: string | null;
  bio: string | null;
  photo_url: string | null;
  practice_name: string | null;
  platform_fee_cents: number;
  years_experience: number | null;
}

type Step = "select" | "intake" | "emergency" | "payment";

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
  const [geoLoading, setGeoLoading] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("select");

  const [symptomText, setSymptomText] = useState("");
  const [duration, setDuration] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [emergencyType, setEmergencyType] = useState<"911" | "988" | "pediatric" | null>(null);

  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [feeUnderstood, setFeeUnderstood] = useState(false);
  const [notEmergency, setNotEmergency] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProviders = async (lat?: number, lng?: number) => {
    const params = new URLSearchParams({ state: "PA" });
    if (lat !== undefined && lng !== undefined) {
      params.set("lat", String(lat));
      params.set("lng", String(lng));
    }
    const res = await fetch(`/api/telehealth/providers?${params}`);
    const data = await res.json();
    const list: Provider[] = data.providers || [];
    setProviders(list);
    if (list.length === 1) {
      setSelectedId(list[0].id);
      setStep("intake");
    }
    return list;
  };

  const handleUseLocation = () => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await fetchProviders(position.coords.latitude, position.coords.longitude);
        setGeoLoading(false);
      },
      () => setGeoLoading(false),
      { timeout: 10000, enableHighAccuracy: false }
    );
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetchProviders();
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
  const phoneDigits = phone.replace(/\D/g, "");
  const canContinueIntake =
    symptomText.trim().length > 3 &&
    phoneDigits.length >= 10 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    dob.length > 0;
  const canSubmit =
    !!selected && locationConfirmed && feeUnderstood && notEmergency && !loading;

  const selectProvider = (id: string) => {
    setSelectedId(id);
    setStep("intake");
  };

  const submitIntake = () => {
    if (!canContinueIntake) return;
    const flag = checkRedFlags(`${symptomText} ${duration}`);
    if (flag) {
      setEmergencyType(flag);
      setStep("emergency");
      return;
    }
    setStep("payment");
  };

  const handleConnect = async () => {
    if (!canSubmit || !selected) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/telehealth/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateAttested: "PA",
          providerId: selected.id,
          patientPhone: phoneDigits,
          patientEmail: email.trim(),
          patientFirstName: firstName.trim(),
          patientLastName: lastName.trim(),
          patientDob: dob,
          symptomSummary: `${symptomText}${duration ? ` (duration: ${duration})` : ""}`,
        }),
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

        <div className="lux-layout">
          <div className="lux-info-col">
            <div className="lux-hero-photo-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="lux-hero-photo"
                src="https://images.unsplash.com/photo-1758691463607-c1220b77aaaa?w=1200&q=80&auto=format&fit=crop"
                alt="A doctor on a phone call with a patient"
              />
            </div>

            <h1 className="lux-title">Talk to a doctor, right now.</h1>
            <p className="lux-subtitle">
              When it&apos;s after hours, the clinic is closed, or waiting
              until morning isn&apos;t an option — a licensed provider is a
              phone call away. No appointment, no waiting room.
            </p>

            <ol className="lux-how-it-works">
              <li>
                <span className="lux-step-num">1</span>
                <div>
                  <strong>Tell us what&apos;s happening</strong>
                  <p>
                    A quick description of your symptoms and how long
                    it&apos;s been going on. We screen for emergencies before
                    anything is charged.
                  </p>
                </div>
              </li>
              <li>
                <span className="lux-step-num">2</span>
                <div>
                  <strong>Secure your connection</strong>
                  <p>
                    Apple Pay, credit card, or HSA/FSA card. One flat fee —
                    only charged once we&apos;ve confirmed a doctor can help.
                  </p>
                </div>
              </li>
              <li>
                <span className="lux-step-num">3</span>
                <div>
                  <strong>Connected in seconds</strong>
                  <p>
                    The doctor calls you through an encrypted, masked line —
                    your real number is never shared, and neither is theirs.
                  </p>
                </div>
              </li>
            </ol>

            <div className="lux-trust-row">
              <span className="lux-trust-badge">🔒 HIPAA-compliant connection</span>
              <span className="lux-trust-badge">✓ NPI-verified providers</span>
              <span className="lux-trust-badge">📍 PA-licensed</span>
            </div>
            <p className="lux-founder-line">
              Built by a team with 15+ years in healthcare.
            </p>
          </div>

          <div className="lux-app-col">
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

        {step === "select" && !loadingProviders && providers.length > 1 && (
          <>
            <button className="lux-geo-btn" onClick={handleUseLocation} disabled={geoLoading}>
              {geoLoading ? "Finding the closest doctor…" : "📍 Find the doctor nearest me"}
            </button>
            <div className="lux-doctor-grid">
              {providers.map((p) => (
                <button
                  key={p.id}
                  className="lux-doctor-card"
                  onClick={() => selectProvider(p.id)}
                >
                  <DoctorAvatar provider={p} />
                  <div className="lux-doctor-name">
                    {p.name}
                    {p.credentials ? `, ${p.credentials}` : ""}
                  </div>
                  {p.specialty && <div className="lux-doctor-specialty">{p.specialty}</div>}
                  {p.practice_name && <div className="lux-doctor-practice">{p.practice_name}</div>}
                  {p.years_experience && (
                    <div className="lux-doctor-practice">{p.years_experience}+ years in practice</div>
                  )}
                  {p.bio && <div className="lux-doctor-bio">{p.bio}</div>}
                  <div className="lux-available-badge">
                    <span className="lux-pulse-dot"></span>Available
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "intake" && selected && (
          <div className="lux-card">
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
              </div>
            </div>

            <h2 className="lux-card-title">A few details first</h2>
            <p className="lux-card-sub">
              Your name and date of birth are used only to document this
              visit in your medical record — never your SSN or insurance ID.
            </p>

            <div className="lux-input-row">
              <input
                type="text"
                className="lux-input"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                aria-label="First name"
              />
              <input
                type="text"
                className="lux-input"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                aria-label="Last name"
              />
            </div>
            <input
              type="date"
              className="lux-input"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              aria-label="Date of birth"
              max={new Date().toISOString().split("T")[0]}
            />

            <h2 className="lux-card-title" style={{ marginTop: 20 }}>
              What&apos;s happening?
            </h2>
            <p className="lux-card-sub">
              A quick description so we can screen for emergencies before
              anything is charged.
            </p>

            <textarea
              className="lux-textarea"
              placeholder="What's going on?"
              value={symptomText}
              onChange={(e) => setSymptomText(e.target.value)}
              rows={3}
              aria-label="Describe what's going on"
            />
            <input
              type="text"
              className="lux-input"
              placeholder="How long has this been going on? (e.g. 2 days)"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              aria-label="Duration"
            />
            <input
              type="tel"
              className="lux-input"
              placeholder="Your phone number (for the call — never shared with the doctor)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-label="Your phone number"
            />
            <input
              type="email"
              className="lux-input"
              placeholder="Email (optional — for an insurance receipt, if your doctor adds one)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email (optional)"
            />

            <button className="lux-btn" onClick={submitIntake} disabled={!canContinueIntake}>
              Continue
            </button>
          </div>
        )}

        {step === "emergency" && (
          <div className="lux-card lux-emergency-card">
            {emergencyType === "988" ? (
              <>
                <h2 className="lux-card-title">I want you to be safe.</h2>
                <p className="lux-card-sub">
                  Please reach out to the 988 Suicide &amp; Crisis Lifeline right
                  now — call or text 988. Free, confidential, available 24/7.
                  You have not been charged.
                </p>
                <a className="lux-btn" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href="tel:988">
                  Call or text 988
                </a>
              </>
            ) : (
              <>
                <h2 className="lux-card-title">This needs ER-level care.</h2>
                <p className="lux-card-sub">
                  What you described could be a medical emergency. Please call
                  911 or get to the nearest emergency room now — this isn&apos;t
                  something a scheduled telehealth call should handle. You have
                  not been charged.
                </p>
                <a className="lux-btn" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href="tel:911">
                  Call 911
                </a>
              </>
            )}
            <Link className="lux-back" href="/">
              &larr; Back to chat
            </Link>
          </div>
        )}

        {step === "payment" && selected && (
          <div className="lux-card">
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

            <h2 className="lux-price">${feeDollars} flat · 30 minutes</h2>
            <p className="lux-card-sub" style={{ marginTop: -10 }}>
              Apple Pay, credit card, or HSA/FSA card. No insurance needed.
            </p>

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
              <li>
                The doctor calls you through an encrypted bridge — your real
                phone number is never shared with them, and theirs is never
                shared with you.
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
            <p className="lux-legal-links">
              By continuing you agree to our{" "}
              <Link href="/terms">Terms</Link>,{" "}
              <Link href="/privacy">Privacy Policy</Link>, and{" "}
              <Link href="/disclaimer">Platform Disclaimer</Link>.
            </p>
          </div>
        )}

          </div>
        </div>

        <Link className="lux-back" href="/">
          &larr; Back to chat
        </Link>
      </main>
    </div>
  );
}

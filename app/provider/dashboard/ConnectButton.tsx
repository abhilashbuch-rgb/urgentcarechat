"use client";

import { useState } from "react";

export default function ConnectButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/provider/connect-onboard", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.onboardingUrl) {
        setError(data.error || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      window.location.href = data.onboardingUrl;
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div>
      <button className="lux-btn" onClick={start} disabled={loading}>
        {loading ? "Starting…" : "Set up payouts with Stripe"}
      </button>
      {error && <div className="telehealth-error">{error}</div>}
    </div>
  );
}

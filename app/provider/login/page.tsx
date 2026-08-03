"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import BrandIcon from "@/app/components/BrandIcon";

export default function ProviderLoginPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendLink = async () => {
    if (!email.includes("@")) return;
    setSending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/provider/auth/callback` },
      });
      if (authError) throw authError;
      setSent(true);
    } catch {
      setError("Something went wrong sending the link. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="lux-shell">
      <header className="lux-header">
        <div className="brand lux-brand">
          <BrandIcon />
          urgentcare<span className="tld">.chat</span>
        </div>
        <div className="lux-tagline">Provider</div>
      </header>

      <main className="lux-main" style={{ maxWidth: 420 }}>
        <div className="lux-card">
          <h1 className="lux-card-title">Provider sign in</h1>
          {sent ? (
            <p className="lux-card-sub">
              Check your email for a sign-in link. It expires shortly, so
              use it soon after it arrives.
            </p>
          ) : (
            <>
              <p className="lux-card-sub">
                Enter the email your practice has on file with us — we&apos;ll
                send a one-time sign-in link, no password needed.
              </p>
              <input
                type="email"
                className="lux-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email"
              />
              {error && <div className="telehealth-error">{error}</div>}
              <button className="lux-btn" onClick={sendLink} disabled={sending || !email.includes("@")}>
                {sending ? "Sending…" : "Send sign-in link"}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

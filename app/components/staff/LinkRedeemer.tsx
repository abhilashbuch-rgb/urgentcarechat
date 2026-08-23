"use client";

import { useRef, useState } from "react";

// Spends the link token from the sign-in email.
//
// POSTs from the client rather than the page doing the work server-side
// on a GET — see app/staff/signin/link/page.tsx — but NOT automatically
// on mount. It used to: a useEffect fired the POST the instant this
// component rendered, on the theory that "mail scanners follow links;
// they do not run JavaScript and then POST." That's true of a basic
// crawler, but not of what it was actually up against — Microsoft
// Defender for Office 365 Safe Links (and equivalents from other
// vendors) renders the page in a real, JS-capable browser specifically
// to catch script-driven redirects, which is exactly what an
// auto-firing useEffect is. A tenant with Safe Links enabled would burn
// every sign-in link before its recipient ever opened the email.
//
// Requiring an actual click is the standard mitigation for this — a
// scanner visits the page; it does not press a button. The token still
// only survives one use either way, so nothing about single-use or
// expiry changes; this only changes who has to act for it to be spent.

export default function LinkRedeemer({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Guards a double-click, not a scanner — the effect that used to need
  // this for React's dev-mode double-run is gone along with it.
  const fired = useRef(false);

  async function redeem() {
    if (fired.current) return;
    fired.current = true;
    setBusy(true);

    const res = await fetch("/api/staff/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      fired.current = false;
      setBusy(false);
      setError(
        body?.error === "no_invite"
          ? "That address hasn't been invited to a clinic here. Ask your administrator to add it."
          : "That link didn't work. It may have been used already, or expired — ask for a new one."
      );
      return;
    }
    const body = await res.json();
    window.location.assign(body.next ?? "/staff");
  }

  if (error) {
    return (
      <>
        <p className="st-signin-sub">{error}</p>
        <a className="st-primary st-link-back" href="/staff/signin">
          Back to sign-in
        </a>
      </>
    );
  }

  return (
    <>
      <p className="st-signin-sub">
        One more tap and you&rsquo;re in &mdash; this confirms it&rsquo;s
        really you, not something in your inbox that visited this link on
        its own.
      </p>
      <button className="st-primary" type="button" onClick={redeem} disabled={busy}>
        {busy ? "Signing you in…" : "Finish signing in"}
      </button>
    </>
  );
}

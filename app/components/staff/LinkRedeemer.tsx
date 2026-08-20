"use client";

import { useEffect, useRef, useState } from "react";

// Spends the link token from the sign-in email.
//
// POSTs on mount rather than the page doing the work server-side on a
// GET — see app/staff/signin/link/page.tsx. Mail scanners follow links;
// they do not run JavaScript and then POST.

export default function LinkRedeemer({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  // React runs effects twice in development. Without this guard the
  // second run redeems an already-consumed token and shows a failure on
  // a sign-in that actually worked.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    (async () => {
      const res = await fetch("/api/staff/auth/email/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => null);

      if (!res?.ok) {
        const body = await res?.json().catch(() => ({}));
        setError(
          body?.error === "no_invite"
            ? "That address hasn't been invited to a clinic here. Ask your administrator to add it."
            : "That link didn't work. It may have been used already, or expired — ask for a new one."
        );
        return;
      }
      const body = await res.json();
      window.location.assign(body.next ?? "/staff");
    })();
  }, [token]);

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

  return <p className="st-signin-sub">One moment&hellip;</p>;
}

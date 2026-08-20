"use client";

import { useEffect, useRef, useState } from "react";

// Spends the link from an invitation email.
//
// POSTs on mount rather than the page acting on a GET, for the same
// reason as LinkRedeemer: mail scanners and security appliances follow
// links on the recipient's behalf. Microsoft Defender for Office 365
// does exactly this, and a GET that accepts an invitation is one that
// Defender accepts before the new hire ever clicks. Scanners do not run
// JavaScript and then POST.

const MESSAGES: Record<string, string> = {
  expired:
    "That invitation has expired. Ask your administrator to send a new one — it takes them a few seconds.",
  unknown:
    "That invitation is no longer valid. It may have been used already, replaced by a newer one, or withdrawn.",
};

export default function InviteRedeemer({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  // React runs effects twice in development; without the guard the second
  // run spends an already-accepted invitation and reports a failure on
  // one that actually worked.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    (async () => {
      const res = await fetch("/api/staff/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => null);

      if (!res?.ok) {
        const body = await res?.json().catch(() => ({}));
        setError(
          MESSAGES[body?.error as string] ??
            "That link didn't work. Ask your administrator to send a new one."
        );
        return;
      }
      const body = await res.json();
      window.location.assign(body.next ?? "/staff/signin");
    })();
  }, [token]);

  if (error) {
    return (
      <>
        <p className="st-signin-sub">{error}</p>
        <a className="st-primary st-link-back" href="/staff/signin">
          Go to sign-in
        </a>
      </>
    );
  }

  return <p className="st-signin-sub">Checking your invitation&hellip;</p>;
}

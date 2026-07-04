"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type ConfirmState =
  | { status: "checking" }
  | { status: "ready"; roomUrl: string; providerName: string }
  | { status: "error"; message: string };

function ConfirmPanel() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [state, setState] = useState<ConfirmState>({ status: "checking" });

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      try {
        const res = await fetch(
          `/api/telehealth/confirm?session_id=${encodeURIComponent(sessionId)}`
        );
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setState({ status: "error", message: data.error || "Something went wrong." });
          return;
        }

        if (data.status === "ready") {
          setState({
            status: "ready",
            roomUrl: data.roomUrl,
            providerName: data.providerName,
          });
          return;
        }

        // Still pending — Stripe hasn't finished confirming payment yet.
        if (attempts < 15) {
          setTimeout(poll, 2000);
        } else {
          setState({
            status: "error",
            message:
              "Payment is taking longer than expected to confirm. Refresh this page in a moment.",
          });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "Something went wrong. Please refresh." });
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="telehealth-card">
        <h1 className="telehealth-title">Something went wrong</h1>
        <p className="telehealth-sub">Missing checkout session.</p>
        <Link className="telehealth-back" href="/telehealth">
          &larr; Try again
        </Link>
      </div>
    );
  }

  if (state.status === "checking") {
    return (
      <div className="telehealth-card">
        <h1 className="telehealth-title">Confirming your payment…</h1>
        <p className="telehealth-sub">This only takes a few seconds.</p>
        <div className="typing" style={{ marginTop: 12 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="telehealth-card">
        <h1 className="telehealth-title">Something went wrong</h1>
        <p className="telehealth-sub">{state.message}</p>
        <Link className="telehealth-back" href="/telehealth">
          &larr; Try again
        </Link>
      </div>
    );
  }

  return (
    <div className="telehealth-card">
      <h1 className="telehealth-title">You&apos;re connected</h1>
      <p className="telehealth-sub">
        {state.providerName} has been notified and is expecting you.
      </p>
      <a
        className="telehealth-btn"
        style={{ display: "block", textAlign: "center", textDecoration: "none" }}
        href={state.roomUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Join the chat now
      </a>
      <Link className="telehealth-back" href="/">
        &larr; Back to chat
      </Link>
    </div>
  );
}

export default function TelehealthSuccess() {
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
        <Suspense
          fallback={
            <div className="telehealth-card">
              <h1 className="telehealth-title">Loading…</h1>
            </div>
          }
        >
          <ConfirmPanel />
        </Suspense>
      </main>
    </>
  );
}

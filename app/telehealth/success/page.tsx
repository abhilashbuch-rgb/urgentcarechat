"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type ConfirmState =
  | { status: "checking" }
  | { status: "ready"; roomUrl: string; providerName: string; expectCallFrom: string | null }
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
            expectCallFrom: data.expectCallFrom || null,
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
      <div className="lux-card">
        <h1 className="lux-card-title">Something went wrong</h1>
        <p className="lux-card-sub">Missing checkout session.</p>
        <Link className="lux-back" href="/telehealth">
          &larr; Try again
        </Link>
      </div>
    );
  }

  if (state.status === "checking") {
    return (
      <div className="lux-card">
        <h1 className="lux-card-title">Confirming your payment…</h1>
        <p className="lux-card-sub">This only takes a few seconds.</p>
        <div className="typing">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="lux-card">
        <h1 className="lux-card-title">Something went wrong</h1>
        <p className="lux-card-sub">{state.message}</p>
        <Link className="lux-back" href="/telehealth">
          &larr; Try again
        </Link>
      </div>
    );
  }

  return (
    <div className="lux-card">
      <h1 className="lux-card-title">You&apos;re connected</h1>
      <p className="lux-card-sub">
        {state.providerName} has been notified and is expecting you.
      </p>
      {state.expectCallFrom && (
        <div className="lux-callout">
          <strong>Answer your phone</strong> in the next few minutes — the
          doctor will call from <strong>{state.expectCallFrom}</strong>, a
          private line. Your real number was never shared with them, and
          theirs was never shared with you.
        </div>
      )}
      <a
        className="lux-btn"
        style={{ display: "block", textAlign: "center", textDecoration: "none" }}
        href={state.roomUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Or join by video instead
      </a>
      <Link className="lux-back" href="/">
        &larr; Back to chat
      </Link>
    </div>
  );
}

export default function TelehealthSuccess() {
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
        <Suspense
          fallback={
            <div className="lux-card">
              <h1 className="lux-card-title">Loading…</h1>
            </div>
          }
        >
          <ConfirmPanel />
        </Suspense>
      </main>
    </div>
  );
}

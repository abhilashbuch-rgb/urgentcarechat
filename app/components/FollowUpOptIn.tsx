"use client";

import { useState } from "react";

interface Props {
  clinicName: string;
  sessionId: string;
  labels: {
    prompt: string;
    placeholder: string;
    submit: string;
    submitting: string;
    success: string;
    error: string;
  };
}

export default function FollowUpOptIn({ clinicName, sessionId, labels }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  if (status === "done") {
    return <div className="followup-done">{labels.success}</div>;
  }

  if (!expanded) {
    return (
      <button className="followup-link" onClick={() => setExpanded(true)}>
        {labels.prompt}
      </button>
    );
  }

  const submit = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/follow-up/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, clinicName, sessionId }),
      });
      if (!res.ok) throw new Error("failed");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="followup-form">
      <input
        type="tel"
        className="followup-input"
        placeholder={labels.placeholder}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        aria-label={labels.placeholder}
      />
      <button
        className="followup-submit"
        onClick={submit}
        disabled={status === "sending" || phone.replace(/\D/g, "").length < 10}
      >
        {status === "sending" ? labels.submitting : labels.submit}
      </button>
      {status === "error" && <div className="followup-error">{labels.error}</div>}
    </div>
  );
}

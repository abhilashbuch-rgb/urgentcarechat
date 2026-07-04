"use client";

import { useState } from "react";

interface Props {
  clinicName: string;
  placeId?: string;
  labels: {
    prompt: string;
    emailPlaceholder: string;
    namePlaceholder: string;
    submit: string;
    submitting: string;
    success: string;
    error: string;
  };
}

export default function ClaimListing({ clinicName, placeId, labels }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  if (status === "done") {
    return <div className="claim-done">{labels.success}</div>;
  }

  if (!expanded) {
    return (
      <button className="claim-link" onClick={() => setExpanded(true)}>
        {labels.prompt}
      </button>
    );
  }

  const submit = async () => {
    if (!email.includes("@")) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/clinics/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicName,
          googlePlaceId: placeId,
          contactName: name,
          contactEmail: email,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="claim-form">
      <input
        type="text"
        className="claim-input"
        placeholder={labels.namePlaceholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={labels.namePlaceholder}
      />
      <input
        type="email"
        className="claim-input"
        placeholder={labels.emailPlaceholder}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label={labels.emailPlaceholder}
      />
      <button
        className="claim-submit"
        onClick={submit}
        disabled={status === "sending" || !email.includes("@")}
      >
        {status === "sending" ? labels.submitting : labels.submit}
      </button>
      {status === "error" && <div className="claim-error">{labels.error}</div>}
    </div>
  );
}

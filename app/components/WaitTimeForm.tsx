"use client";

import { useState } from "react";

interface Props {
  token: string;
  initialWaitMinutes: number | null;
}

const QUICK_OPTIONS = [0, 15, 30, 45, 60, 90];

export default function WaitTimeForm({ token, initialWaitMinutes }: Props) {
  const [waitMinutes, setWaitMinutes] = useState<number | null>(initialWaitMinutes);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async (value: number | null) => {
    setStatus("saving");
    try {
      const res = await fetch("/api/clinics/wait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, waitMinutes: value }),
      });
      if (!res.ok) throw new Error("failed");
      setWaitMinutes(value);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="wait-form">
      <div className="wait-current">
        {waitMinutes === null ? "No current wait posted" : `Current: ~${waitMinutes} min`}
      </div>

      <div className="wait-options">
        {QUICK_OPTIONS.map((m) => (
          <button
            key={m}
            className={`wait-option${waitMinutes === m ? " active" : ""}`}
            onClick={() => save(m)}
            disabled={status === "saving"}
          >
            {m === 0 ? "No wait" : `~${m} min`}
          </button>
        ))}
      </div>

      <button
        className="wait-clear"
        onClick={() => save(null)}
        disabled={status === "saving" || waitMinutes === null}
      >
        Clear (no data)
      </button>

      {status === "saved" && <div className="wait-status wait-status-ok">Updated ✓</div>}
      {status === "error" && (
        <div className="wait-status wait-status-error">Something went wrong — try again.</div>
      )}
    </div>
  );
}

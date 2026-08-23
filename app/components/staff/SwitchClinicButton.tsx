"use client";

import { useState } from "react";

export default function SwitchClinicButton({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch("/api/staff/switch-org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setError(true);
      return;
    }
    window.location.assign("/staff");
  }

  return (
    <div>
      <button className="st-board-btn st-board-btn-later" type="button" onClick={go} disabled={busy}>
        {busy ? "Switching…" : "Switch to this clinic"}
      </button>
      {error && <p className="st-field-hint">That didn&rsquo;t switch. Try again.</p>}
    </div>
  );
}

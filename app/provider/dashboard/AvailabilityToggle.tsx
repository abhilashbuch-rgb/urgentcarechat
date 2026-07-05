"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";

export default function AvailabilityToggle({
  providerId,
  initial,
}: {
  providerId: string;
  initial: boolean;
}) {
  const [available, setAvailable] = useState(initial);
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    setSaving(true);
    const next = !available;
    const supabase = createBrowserSupabase();
    const { error } = await supabase
      .from("providers")
      .update({ is_available: next })
      .eq("id", providerId);
    if (!error) setAvailable(next);
    setSaving(false);
  };

  return (
    <button
      className={`lux-availability-toggle${available ? " on" : ""}`}
      onClick={toggle}
      disabled={saving}
    >
      <span className="lux-pulse-dot" style={{ background: available ? "#6fcf97" : "#888" }}></span>
      {available ? "Available now — patients can reach you" : "Offline — toggle on to take patients"}
    </button>
  );
}

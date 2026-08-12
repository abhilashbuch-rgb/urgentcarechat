"use client";

import { useEffect, useState } from "react";
import { STATE_LABELS, type FluActivity } from "@/lib/cdc-flu";

// Location-aware flu banner. Rendered client-side on purpose: the state
// comes from the visitor's own request, so a server-rendered banner would
// either have to be pinned to one state (what it used to do — always
// Pennsylvania) or force the whole page out of static generation.
//
// The state is a CDN-derived region code, not a coordinate, and the choice
// is remembered in localStorage rather than sent anywhere.

const STORAGE_KEY = "uc_flu_state";

// Sorted by display name so the picker reads alphabetically, with the two
// "the ..." labels ("the District of Columbia") sorting on their real name.
const STATE_OPTIONS = Object.entries(STATE_LABELS)
  .map(([abbrev, label]) => ({ abbrev, label: label.replace(/^the /, "") }))
  .sort((a, b) => a.label.localeCompare(b.label));

export default function FluBanner({ className = "" }: { className?: string }) {
  const [activity, setActivity] = useState<FluActivity | null>(null);
  const [failed, setFailed] = useState(false);

  // Read the saved state during initialization rather than in an effect, so
  // the first fetch already knows which state to ask for instead of firing
  // once for the geolocated default and again for the saved one. Returns
  // null during SSR, which matches what the client renders before the fetch
  // resolves (nothing), so there's no hydration mismatch.
  const [chosen, setChosen] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved && Object.hasOwn(STATE_LABELS, saved) ? saved : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let live = true;
    const url = chosen
      ? `/api/flu-activity?state=${encodeURIComponent(chosen)}`
      : "/api/flu-activity";

    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: FluActivity) => {
        if (live) setActivity(data);
      })
      .catch(() => {
        if (live) setFailed(true);
      });

    return () => {
      live = false;
    };
  }, [chosen]);

  const pick = (state: string) => {
    setChosen(state);
    setActivity(null);
    try {
      window.localStorage.setItem(STORAGE_KEY, state);
    } catch {
      // Private-mode / storage-disabled: the choice just won't persist.
    }
  };

  // Nothing to show yet, or the whole thing is unreachable. This is optional
  // context on both pages that use it, so it stays out of the way instead of
  // reserving space or announcing its own failure.
  if (failed) return null;
  if (!activity) return null;

  const known = activity.level !== "unknown" && activity.weightedIli !== null;
  const label = activity.label || activity.state;

  const picker = (
    <label className="flu-picker">
      <span className="flu-picker-label">State</span>
      <select
        value={chosen ?? activity.state}
        onChange={(e) => pick(e.target.value)}
        aria-label="Show flu activity for a different state"
      >
        {!chosen && !activity.state && <option value="">Choose…</option>}
        {STATE_OPTIONS.map((o) => (
          <option key={o.abbrev} value={o.abbrev}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  if (!known) {
    return (
      <div className={`flu-banner flu-unknown ${className}`.trim()}>
        <span>
          {activity.state
            ? `No current flu reporting for ${label}.`
            : "Pick a state to see local flu activity."}
        </span>
        {picker}
      </div>
    );
  }

  return (
    <div className={`flu-banner flu-${activity.level} ${className}`.trim()}>
      <strong>
        Flu activity in {label}: {activity.level}
      </strong>
      <span className="flu-detail">
        {" "}
        &middot; {activity.weightedIli!.toFixed(1)}% of outpatient visits (CDC
        FluView)
        {/* Say so when the number is regional — the visitor's state doesn't
            report to ILINet, and passing a multi-state figure off as theirs
            would be quietly wrong. */}
        {activity.scope === "region" &&
          ` · ${STATE_LABELS[activity.state] ?? activity.state} doesn't report separately`}
      </span>
      {picker}
    </div>
  );
}

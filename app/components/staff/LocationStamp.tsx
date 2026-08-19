"use client";

import { useEffect, useRef, useState } from "react";
import {
  classify,
  formatDistance,
  isPlausible,
  type Fix,
  type LocationStatus,
  type OrgGeofence,
} from "@/lib/staff/geo";

// The location stamp on a shift log.
//
// SHOWN BEFORE SUBMIT, NOT AFTER. The person filling the form finds out
// where the app thinks they are while they can still do something about
// it — walk back inside, or write the reason. Discovering after filing
// that a reading was recorded as off-site is how somebody ends up filing
// a second one.
//
// THE NOTICE IS PERSISTENT AND SITS NEXT TO THE CONTROL, the same
// decision as the PHI line on CameraProof. Location is read once, here,
// at submit time. Telling people that once during onboarding is not a
// disclosure anybody remembers; telling them every time is.
//
// IT ASKS ON MOUNT RATHER THAN ON A BUTTON PRESS. A permission prompt
// that appears when you tap Submit is a prompt that interrupts the one
// action the person came to complete, and on a slow fix it stalls the
// submit for ten seconds with no explanation. Asking as the form opens
// means the answer is usually ready by the time it is needed.
//
// enableHighAccuracy IS OFF. It powers up GPS for a fix this feature
// does not need — a 150m radius is not decided by the difference between
// 8m and 40m — and indoors it commonly just spends fifteen seconds
// failing before falling back to the WiFi fix it would have returned
// immediately. maximumAge lets a fix from the last two minutes stand,
// which is the common case of filing two logs back to back.

const TIMEOUT_MS = 10_000;
const MAX_AGE_MS = 120_000;

export interface LocationResult {
  fix: Fix | null;
  denied: boolean;
  status: LocationStatus;
  distanceM: number | null;
  needsNote: boolean;
}

export default function LocationStamp({
  org,
  onChange,
}: {
  org: OrgGeofence;
  onChange: (r: LocationResult) => void;
}) {
  const [state, setState] = useState<"asking" | "done">(
    org.mode === "off" ? "done" : "asking"
  );
  const [result, setResult] = useState<LocationResult | null>(null);
  // React runs effects twice in development. Without this the prompt is
  // requested twice and the second result races the first.
  const asked = useRef(false);

  useEffect(() => {
    // Nothing to do, and nothing to report: this component renders null,
    // and a form that never reports a location is classified `not_asked`
    // by the server from the clinic's own mode. Reporting it from here
    // would be a setState in an effect for a value the server already
    // knows.
    if (org.mode === "off") return;
    if (asked.current) return;
    asked.current = true;

    function settle(fix: Fix | null, denied: boolean) {
      const c = classify(org, fix, denied);
      const r: LocationResult = { fix, denied, ...c };
      setResult(r);
      setState("done");
      onChange(r);
    }

    if (!("geolocation" in navigator)) {
      settle(null, false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        // A browser can hand back a well-formed object describing
        // nowhere. Validating here rather than trusting the shape keeps
        // 0,0 out of the record as a confident-looking 5,000km.
        if (!isPlausible(latitude, longitude)) {
          settle(null, false);
          return;
        }
        settle(
          {
            lat: latitude,
            lng: longitude,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
          },
          false
        );
      },
      (err) => settle(null, err.code === err.PERMISSION_DENIED),
      {
        enableHighAccuracy: false,
        timeout: TIMEOUT_MS,
        maximumAge: MAX_AGE_MS,
      }
    );
    // org is a stable prop for the life of the form; re-running this on
    // an identity change would re-prompt mid-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (org.mode === "off") return null;

  const cls =
    result?.status === "on_site"
      ? "st-geo st-geo-ok"
      : result?.status === "off_site" || result?.status === "denied"
        ? "st-geo st-geo-warn"
        : "st-geo";

  return (
    <div className={cls} role="status">
      <div className="st-geo-line">
        {state === "asking" && <strong>Checking location…</strong>}

        {result?.status === "on_site" && (
          <strong>At the clinic — {formatDistance(result.distanceM)} away</strong>
        )}

        {result?.status === "off_site" && (
          <strong>
            {formatDistance(result.distanceM)} from the clinic
          </strong>
        )}

        {result?.status === "denied" && (
          <strong>Location permission declined</strong>
        )}

        {result?.status === "unavailable" && (
          <strong>Location unavailable on this device</strong>
        )}
      </div>

      {/* Said every time, next to the control that does it. */}
      <p className="st-geo-note">
        {result?.status === "off_site"
          ? "This log will still be filed. It will be recorded as filed away from the clinic, with the distance, and your administrator will see it."
          : result?.status === "denied"
            ? "This log will still be filed, recorded as location declined. Nothing else about your device is read."
            : result?.status === "unavailable"
              ? "This log will still be filed. Indoors without GPS this is common and is not held against anyone."
              : "Your location is read once, now, only to stamp this log. It is not tracked between logs."}
      </p>
    </div>
  );
}

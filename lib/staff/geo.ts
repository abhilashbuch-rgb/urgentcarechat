// Where a log was filed from.
//
// READ THE HEADER OF supabase/staff-geofence.sql BEFORE CHANGING ANY OF
// THIS. The short version: browser geolocation is not attestable, this is
// provenance on a record rather than an access control, and it must never
// fail closed — a blocked honest reading costs more than a flagged
// dishonest one.
//
// This module is the single definition of "how far" and "is that near
// enough", imported by the submit route AND by the client component that
// shows the person their status before they file. Two implementations
// would eventually disagree about the boundary case, and the one that
// matters is the server's.

/** What the clinic has configured. */
export type GeofenceMode = "off" | "record" | "require";

/** Where a filing ended up. See the column comment in the migration for
 *  why `denied` and `unavailable` are separate. */
export type LocationStatus =
  | "not_asked"
  | "on_site"
  | "off_site"
  | "unavailable"
  | "denied";

export interface Fix {
  lat: number;
  lng: number;
  /** Metres, as claimed by the device. */
  accuracy: number | null;
}

export interface OrgGeofence {
  lat: number | null;
  lng: number | null;
  radiusM: number;
  mode: GeofenceMode;
}

const EARTH_RADIUS_M = 6_371_000;

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * Haversine, not the equirectangular approximation. The cheap version is
 * fine at a few hundred metres near the equator and drifts badly at high
 * latitude, and "badly" here means a clinic in Anchorage getting a
 * different answer than one in Miami for the same real distance. The
 * cost difference is irrelevant at one call per log submission.
 */
export function distanceM(a: Fix | { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(h));
}

/** True for a latitude/longitude pair that could describe somewhere. */
export function isPlausible(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // 0,0 is in the Gulf of Guinea and is what a broken client sends
    // when it means "I have no idea". Treating it as a real fix would
    // put every such filing thousands of miles off-site with a
    // confident-looking number attached.
    !(lat === 0 && lng === 0)
  );
}

export interface Classified {
  status: LocationStatus;
  /** Null when there is no fix, or the clinic has no coordinates to
   *  measure against. */
  distanceM: number | null;
  /** True when the clinic requires a written reason for this outcome. */
  needsNote: boolean;
}

/**
 * Decide what a filing's location outcome is.
 *
 * `fix` is null when the browser produced nothing — either because the
 * person refused (`denied: true`) or because it failed (timeout, no
 * sensor). The distinction is carried through rather than collapsed.
 *
 * THE ACCURACY GRACE. A fix whose own claimed accuracy is worse than the
 * radius cannot place anybody: a point 200m away with ±500m of error is
 * equally consistent with standing in the building. Treating that as
 * off-site would flag staff for their device's shortcomings, so the
 * radius is widened by the claimed accuracy before the comparison. This
 * is generous by design and is the reason the feature is honest about
 * being a deterrent rather than a gate — see the migration header.
 */
export function classify(
  org: OrgGeofence,
  fix: Fix | null,
  denied = false
): Classified {
  if (org.mode === "off") {
    return { status: "not_asked", distanceM: null, needsNote: false };
  }

  const requireNote = org.mode === "require";

  if (!fix) {
    return {
      status: denied ? "denied" : "unavailable",
      distanceM: null,
      needsNote: requireNote,
    };
  }

  // Configured to enforce but with nowhere to measure from should be
  // impossible — the migration has a CHECK forbidding it — but a null
  // here must not become a NaN comparison that silently reads as
  // on-site.
  if (org.lat === null || org.lng === null) {
    return { status: "unavailable", distanceM: null, needsNote: requireNote };
  }

  const d = distanceM(fix, { lat: org.lat, lng: org.lng });
  const tolerance =
    org.radiusM + Math.max(0, Math.min(fix.accuracy ?? 0, 2000));
  const onSite = d <= tolerance;

  return {
    status: onSite ? "on_site" : "off_site",
    distanceM: d,
    needsNote: requireNote && !onSite,
  };
}

/** Human distance for a status line. Metres under a kilometre, because
 *  "0.1 km" is worse than "120 m" for the only question being asked. */
export function formatDistance(m: number | null): string {
  if (m === null) return "unknown";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

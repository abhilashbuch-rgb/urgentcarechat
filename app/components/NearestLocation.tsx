"use client";

import { useEffect, useState } from "react";

// The tenant's closest location to this visitor, shown above the hero
// headline — the first thing on the page is their own clinic, by name,
// with how far away it is.
//
// Client-side on purpose. Doing it on the server would put a Google Places
// call in front of every page render, so the headline would wait on a
// network round trip. Here the hero paints immediately and this fills in.
//
// Location comes from Vercel's edge geolocation (see /api/clinics), so
// there's no browser permission prompt — being asked for your location
// before you've engaged with a page is a reliable way to lose the visitor.

interface Nearest {
  name: string;
  distance: string;
  open: boolean;
  hours: string;
  directionsUrl: string;
}

export default function NearestLocation({ tenantSlug }: { tenantSlug: string }) {
  const [nearest, setNearest] = useState<Nearest | null>(null);

  useEffect(() => {
    let live = true;

    fetch(`/api/clinics?tenant=${encodeURIComponent(tenantSlug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const first = data?.clinics?.[0];
        // Results are distance-ordered inside a tenant portal, so the first
        // is the closest. No result is a normal outcome — a visitor outside
        // the brand's footprint, or one the edge couldn't place — and this
        // renders nothing rather than an apology.
        if (live && first?.name) setNearest(first);
      })
      .catch(() => {
        // Decorative. A failure here must never disturb the hero.
      });

    return () => {
      live = false;
    };
  }, [tenantSlug]);

  if (!nearest) return null;

  return (
    <a
      className="tp-nearest"
      href={nearest.directionsUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="tp-nearest-label">Closest to you</span>
      <span className="tp-nearest-name">{nearest.name}</span>
      <span className="tp-nearest-meta">
        {nearest.distance}
        {nearest.open && (
          <>
            {" · "}
            <span className="tp-nearest-open">Open now</span>
          </>
        )}
      </span>
    </a>
  );
}

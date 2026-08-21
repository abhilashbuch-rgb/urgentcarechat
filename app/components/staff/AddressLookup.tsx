"use client";

import { useState } from "react";

// Type an address, get coordinates. The two number fields stay editable
// throughout — this fills them in, it does not own them.
//
// The clinic almost certainly knows its address and almost certainly does
// not know its latitude. Asking for the second is how a setup screen ends
// with the field left blank, and a blank latitude means geolocation
// stamping measures against nothing.

interface Hit {
  lat: number;
  lng: number;
  label: string;
}

export default function AddressLookup({
  initialLat,
  initialLng,
}: {
  initialLat: number | null;
  initialLng: number | null;
}) {
  const [address, setAddress] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lat, setLat] = useState(initialLat === null ? "" : String(initialLat));
  const [lng, setLng] = useState(initialLng === null ? "" : String(initialLng));

  async function lookup() {
    if (busy || address.trim().length < 6) return;
    setBusy(true);
    setError(null);
    setHits(null);

    const res = await fetch("/api/staff/settings/geocode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: address.trim() }),
    }).catch(() => null);

    setBusy(false);

    if (!res?.ok) {
      setError(
        "That lookup didn't work. You can type the coordinates in below instead — right-click your clinic in any map and copy them."
      );
      return;
    }
    const data = (await res.json()) as { results: Hit[] };
    if (data.results.length === 0) {
      setError("No match for that address. Try it without the suite number.");
      return;
    }
    setHits(data.results);
  }

  return (
    <div className="st-geo">
      <label className="st-field">
        <span className="st-field-label">Clinic street address</span>
        <div className="st-geo-row">
          <input
            className="st-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="934 Montgomery Ave, Narberth PA 19072"
            /* Enter here would submit the settings form and save a
               half-filled clinic. */
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                lookup();
              }
            }}
          />
          <button
            type="button"
            className="st-btn"
            onClick={lookup}
            disabled={busy || address.trim().length < 6}
          >
            {busy ? "Looking…" : "Find"}
          </button>
        </div>
        <span className="st-field-hint">
          The address isn&rsquo;t stored &mdash; only the coordinates it
          resolves to, which is what a filing is measured against.
        </span>
      </label>

      {error && (
        <p className="st-log-hint" role="status">
          {error}
        </p>
      )}

      {/* MORE THAN ONE MATCH IS NORMAL AND THE OWNER PICKS. A street name
          that exists in two adjacent boroughs is common, and centring a
          geofence on the wrong one stamps every filing as off-site. */}
      {hits && (
        <ul className="st-geo-hits">
          {hits.map((h) => (
            <li key={`${h.lat},${h.lng}`}>
              <button
                type="button"
                className={`st-geo-hit${
                  String(h.lat) === lat && String(h.lng) === lng
                    ? " st-geo-hit-on"
                    : ""
                }`}
                onClick={() => {
                  setLat(String(h.lat));
                  setLng(String(h.lng));
                }}
              >
                <span className="st-geo-hit-label">{h.label}</span>
                <span className="st-geo-hit-coord">
                  {h.lat.toFixed(6)}, {h.lng.toFixed(6)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="st-geo-pair">
        <label className="st-field">
          <span className="st-field-label">Latitude</span>
          <input
            className="st-input"
            name="latitude"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            inputMode="decimal"
            placeholder="40.0115093"
          />
        </label>
        <label className="st-field">
          <span className="st-field-label">Longitude</span>
          <input
            className="st-input"
            name="longitude"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            inputMode="decimal"
            placeholder="-75.2608312"
          />
        </label>
      </div>
      <span className="st-field-hint">
        Leave both blank if you&rsquo;d rather not use location at all.
        Filling in only one is refused &mdash; half a coordinate would put
        the clinic on the equator.
      </span>
    </div>
  );
}

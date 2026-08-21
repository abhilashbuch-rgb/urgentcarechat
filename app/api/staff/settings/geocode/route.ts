import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { atLeast } from "@/lib/staff/roles";
import { PRODUCT_NAME, ROOT_DOMAIN } from "@/lib/site";

// POST /api/staff/settings/geocode — turn a street address into a
// latitude and longitude, so an owner does not have to know what one is.
//
// NOMINATIM, AND ITS TERMS. OpenStreetMap's geocoder is free and requires
// a real User-Agent identifying the application, and no heavy automated
// use. This is called when somebody presses a button while setting their
// clinic up — once or twice per clinic, ever — which is squarely inside
// what it is for.
//
// CANDIDATES, NOT AN ANSWER. It returns up to three and the owner picks.
// "934 Montgomery Ave" matched both a Narberth and a Wynnewood address
// 56m apart when this clinic was set up by hand; silently taking the
// first would have been right that time and wrong eventually, and a
// geofence centred on the wrong building stamps every filing as off-site.
//
// A FAILURE HERE IS NOT A FAILURE TO SET UP. If the lookup is down or
// finds nothing, the form still accepts coordinates typed by hand — the
// button is a convenience, not the only route.

export const runtime = "nodejs";

interface Hit {
  lat: string;
  lon: string;
  display_name: string;
}

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  if (!atLeast(auth.ctx.session.role, "org_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const address = String(body.address ?? "").trim().slice(0, 200);
  if (address.length < 6) {
    return NextResponse.json({ error: "too_short" }, { status: 400 });
  }

  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=3&addressdetails=0&q=" +
    encodeURIComponent(address);

  let hits: Hit[];
  try {
    const res = await fetch(url, {
      headers: {
        // Their usage policy asks for an identifying agent and a contact
        // route. A generic agent is the thing that gets an application
        // blocked.
        "User-Agent": `${PRODUCT_NAME} clinic setup (https://${ROOT_DOMAIN})`,
        Accept: "application/json",
      },
      // Somebody is watching a spinner. Ten seconds and then hand-entry.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "lookup_failed" }, { status: 502 });
    }
    hits = (await res.json()) as Hit[];
  } catch {
    return NextResponse.json({ error: "lookup_failed" }, { status: 502 });
  }

  const results = hits
    .map((h) => ({
      lat: Number(h.lat),
      lng: Number(h.lon),
      label: h.display_name,
    }))
    .filter(
      (r) =>
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lng) &&
        // 0,0 is in the Gulf of Guinea and is what a broken geocoder
        // returns when it means "no idea".
        !(r.lat === 0 && r.lng === 0)
    );

  return NextResponse.json({ ok: true, results });
}

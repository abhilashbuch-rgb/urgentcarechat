import { NextRequest, NextResponse } from "next/server";
import { fetchFluActivity, isTrackedState } from "@/lib/cdc-flu";

// GET /api/flu-activity — flu activity for the visitor's own state.
//
// Location comes from Vercel's edge geo headers, which are derived from the
// request IP at the CDN and cost nothing: no browser permission prompt, no
// coordinates, nothing stored. `?state=XX` overrides it, which is what the
// state picker on the banner sends.
//
// Fails soft with level:"unknown" and a 200 rather than erroring — this
// feeds a decorative banner, and a red API error is worse than no banner.

function resolveState(req: NextRequest): string | null {
  const explicit = req.nextUrl.searchParams.get("state");
  if (explicit && isTrackedState(explicit)) return explicit.toUpperCase();

  // Only trust the region header for US visitors — "region" outside the US
  // is a province/county code that can collide with a US state abbreviation
  // (e.g. Canada's "NS", India's "OR").
  const country = req.headers.get("x-vercel-ip-country");
  if (country && country !== "US") return null;

  const region = req.headers.get("x-vercel-ip-country-region");
  if (region && isTrackedState(region)) return region.toUpperCase();

  return null;
}

export async function GET(req: NextRequest) {
  const state = resolveState(req);

  if (!state) {
    return NextResponse.json(
      {
        level: "unknown",
        weightedIli: null,
        epiweek: null,
        state: "",
        label: "",
        scope: "state",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const activity = await fetchFluActivity(state);

  // An explicit ?state= response is identical for every visitor, so the CDN
  // can hold it. A geolocated one varies by visitor at the same URL, so it
  // must not be shared — that's a cache key the URL doesn't express.
  const explicit = req.nextUrl.searchParams.get("state");
  const cacheControl = explicit
    ? "public, s-maxage=3600, stale-while-revalidate=86400"
    : "private, max-age=1800";

  return NextResponse.json(activity, {
    headers: { "Cache-Control": cacheControl },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { distanceMiles } from "@/lib/geo";
import { isWaitStale } from "@/lib/wait-time";

// ============================================================
// /api/clinics — Real clinic search via Google Places API (New)
// Geocodes zip → lat/lng, then searches for urgent care nearby.
// Merges Supabase override data when available.
// Caches results by zip for 1 hour to reduce API costs.
// ============================================================

interface PlaceResult {
  name: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  rating: number;
  open: boolean;
  hours: string;
  placeId: string;
  distance: string;
  services: string[];
  insurance: string[];
  directionsUrl: string;
  websiteUrl: string;
  featured: boolean;
  network: boolean;
  waitMinutes: number | null;
}

// Default services that most urgent care clinics offer
const DEFAULT_URGENT_CARE_SERVICES = [
  "x-ray",
  "lab",
  "covid_testing",
  "vaccinations",
];

// In-memory cache: zip → { results, timestamp }
const cache = new Map<
  string,
  { results: PlaceResult[]; timestamp: number }
>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Geocode a zip code to lat/lng using Google Geocoding API
async function geocodeZip(
  zip: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${zip}&components=country:US&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status === "OK" && data.results.length > 0) {
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  }
  return null;
}

// Format current hours status from Google Places opening hours
function formatHoursStatus(openingHours: {
  openNow?: boolean;
  weekdayDescriptions?: string[];
} | undefined): { open: boolean; hours: string } {
  if (!openingHours) {
    return { open: false, hours: "Hours unavailable" };
  }

  const isOpen = openingHours.openNow ?? false;

  if (openingHours.weekdayDescriptions && openingHours.weekdayDescriptions.length > 0) {
    // Get today's day of week (0 = Sunday in JS, but weekdayDescriptions starts Monday)
    const today = new Date().getDay();
    // weekdayDescriptions: [Monday, Tuesday, ..., Sunday]
    // JS getDay: 0=Sunday, 1=Monday, ...
    const dayIndex = today === 0 ? 6 : today - 1;
    const todayHours = openingHours.weekdayDescriptions[dayIndex] || "";
    // Extract just the hours part (after the day name)
    const hoursPart = todayHours.replace(/^[^:]+:\s*/, "").trim();

    if (isOpen) {
      return { open: true, hours: `Open · ${hoursPart}` };
    } else {
      return { open: false, hours: `Closed · ${hoursPart}` };
    }
  }

  return { open: isOpen, hours: isOpen ? "Open now" : "Closed" };
}

// Merges in our own clinics-table data on top of the raw Google Places
// results: services/insurance overrides, the featured/network-boost
// flag, and the current-wait signal. Deliberately run fresh on every
// request (never cached — see the 1-hour Google Places cache below)
// since wait time in particular needs to stay near-real-time.
async function enrichWithSupabase(results: PlaceResult[]): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  const placeIds = results.map((r) => r.placeId).filter(Boolean);
  if (placeIds.length === 0) return;

  try {
    const overrideRes = await fetch(
      `${supabaseUrl}/rest/v1/clinics?google_place_id=in.(${placeIds
        .map((id) => `"${id}"`)
        .join(",")})&select=google_place_id,services,insurance_tags,is_featured,brand,current_wait_minutes,wait_updated_at`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!overrideRes.ok) return;

    const overrides: {
      google_place_id: string;
      services: string[];
      insurance_tags: string[];
      is_featured: boolean | null;
      brand: string | null;
      current_wait_minutes: number | null;
      wait_updated_at: string | null;
    }[] = await overrideRes.json();

    // A paid is_featured on ANY location of a brand boosts every
    // location of that brand in this result set — a chain (e.g.
    // AFC Urgent Care) pays once and its whole local footprint
    // benefits, not just the one clinic that's individually featured.
    const featuredBrands = new Set(
      overrides.filter((o) => o.is_featured && o.brand).map((o) => o.brand)
    );

    for (const override of overrides) {
      const match = results.find((r) => r.placeId === override.google_place_id);
      if (!match) continue;

      if (override.services?.length) match.services = override.services;
      if (override.insurance_tags?.length) match.insurance = override.insurance_tags;

      const networkBoosted = !!override.brand && featuredBrands.has(override.brand);
      match.featured = !!override.is_featured || networkBoosted;
      match.network = networkBoosted && !override.is_featured;

      match.waitMinutes =
        override.current_wait_minutes !== null && !isWaitStale(override.wait_updated_at)
          ? override.current_wait_minutes
          : null;
    }
  } catch (enrichErr) {
    // Supabase enrichment failure should not block results
    console.error("Supabase enrichment failed:", enrichErr);
  }
}

// Featured/network-boosted first, then open, then by distance.
function sortClinics(results: PlaceResult[]): void {
  results.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    if (a.open !== b.open) return a.open ? -1 : 1;
    return parseFloat(a.distance) - parseFloat(b.distance);
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const zip = searchParams.get("zip");
  const insurance = searchParams.get("insurance");
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_PLACES_API_KEY not configured");
    return NextResponse.json(
      { error: "Service temporarily unavailable" },
      { status: 503 }
    );
  }

  // Either zip or lat/lng must be provided
  let centerLat: number;
  let centerLng: number;
  let cacheKey: string;

  if (lat && lng) {
    centerLat = parseFloat(lat);
    centerLng = parseFloat(lng);
    if (isNaN(centerLat) || isNaN(centerLng)) {
      return NextResponse.json(
        { error: "Invalid coordinates" },
        { status: 400 }
      );
    }
    cacheKey = `${centerLat.toFixed(2)},${centerLng.toFixed(2)}`;
  } else if (zip && /^\d{5}$/.test(zip)) {
    cacheKey = zip;

    // Check cache first — the cache holds raw (pre-enrichment) Google
    // Places results, so is_featured/network/wait still get refreshed
    // from Supabase on every request, cache hit or not.
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      const results = cached.results.map((r) => ({ ...r }));
      await enrichWithSupabase(results);
      sortClinics(results);

      let filtered = results;
      if (insurance && insurance.toLowerCase() !== "skip" && insurance.toLowerCase() !== "none") {
        filtered = filterByInsurance(results, insurance);
      }
      return NextResponse.json({ clinics: filtered.slice(0, 5) });
    }

    const coords = await geocodeZip(zip, apiKey);
    if (!coords) {
      return NextResponse.json(
        { error: "Could not find that zip code. Please try a different one." },
        { status: 400 }
      );
    }
    centerLat = coords.lat;
    centerLng = coords.lng;
  } else {
    return NextResponse.json(
      { error: "Please provide a valid 5-digit zip code" },
      { status: 400 }
    );
  }

  try {
    // Call Google Places API (New) — Text Search
    const placesRes = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.currentOpeningHours,places.location,places.websiteUri",
        },
        body: JSON.stringify({
          textQuery: "urgent care",
          locationBias: {
            circle: {
              center: { latitude: centerLat, longitude: centerLng },
              radius: 16093.4, // 10 miles in meters
            },
          },
          pageSize: 10,
        }),
      }
    );

    if (!placesRes.ok) {
      const errorText = await placesRes.text();
      console.error("Google Places API error:", placesRes.status, errorText);
      return NextResponse.json(
        { error: "Clinic search is temporarily unavailable. Please try again." },
        { status: 502 }
      );
    }

    const placesData = await placesRes.json();
    const places = placesData.places || [];

    // Transform to our format
    const results: PlaceResult[] = places.map(
      (place: {
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        nationalPhoneNumber?: string;
        rating?: number;
        currentOpeningHours?: {
          openNow?: boolean;
          weekdayDescriptions?: string[];
        };
        location?: { latitude?: number; longitude?: number };
        websiteUri?: string;
      }) => {
        const placeLat = place.location?.latitude || 0;
        const placeLng = place.location?.longitude || 0;
        const dist = distanceMiles(centerLat, centerLng, placeLat, placeLng);
        const hoursInfo = formatHoursStatus(place.currentOpeningHours);

        return {
          name: place.displayName?.text || "Unknown Clinic",
          address: place.formattedAddress || "",
          phone: place.nationalPhoneNumber || "",
          lat: placeLat,
          lng: placeLng,
          rating: place.rating || 0,
          open: hoursInfo.open,
          hours: hoursInfo.hours,
          placeId: place.id || "",
          distance: `${dist.toFixed(1)} mi`,
          services: [...DEFAULT_URGENT_CARE_SERVICES],
          insurance: [],
          directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
            place.formattedAddress || ""
          )}&destination_place_id=${place.id || ""}`,
          websiteUrl: place.websiteUri || "",
          featured: false,
          network: false,
          waitMinutes: null,
        };
      }
    );

    // Cache the raw Google Places results before enrichment/sorting —
    // enrichWithSupabase always runs fresh below, cache hit or not.
    cache.set(cacheKey, { results: results.map((r) => ({ ...r })), timestamp: Date.now() });

    await enrichWithSupabase(results);
    sortClinics(results);

    // Apply insurance filter if requested
    let filteredResults = results;
    if (
      insurance &&
      insurance.toLowerCase() !== "skip" &&
      insurance.toLowerCase() !== "none"
    ) {
      filteredResults = filterByInsurance(results, insurance);
    }

    console.log(
      `[clinics] zip=${zip || "geo"} results=${results.length} filtered=${filteredResults.length}`
    );

    return NextResponse.json({ clinics: filteredResults.slice(0, 5) });
  } catch (err) {
    console.error(
      "Clinics API error:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json(
      { error: "Clinic search failed. Please try again." },
      { status: 500 }
    );
  }
}

function filterByInsurance(
  clinics: PlaceResult[],
  insurance: string
): PlaceResult[] {
  const filtered = clinics.filter((c) =>
    c.insurance.some((i) =>
      i.toLowerCase().includes(insurance.toLowerCase())
    )
  );
  // If no matches, return all with a note (the frontend can display this)
  if (filtered.length === 0) {
    return clinics.map((c) => ({
      ...c,
      insurance:
        c.insurance.length > 0
          ? c.insurance
          : ["Insurance info unavailable — call to confirm"],
    }));
  }
  return filtered;
}

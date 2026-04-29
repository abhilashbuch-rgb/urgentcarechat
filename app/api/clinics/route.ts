import { NextRequest, NextResponse } from "next/server";

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

// Calculate distance between two lat/lng points in miles
function distanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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

    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      let results = cached.results;
      if (insurance && insurance.toLowerCase() !== "skip" && insurance.toLowerCase() !== "none") {
        results = filterByInsurance(results, insurance);
      }
      return NextResponse.json({ clinics: results.slice(0, 5) });
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
        };
      }
    );

    // Sort: open clinics first, then by distance
    results.sort((a, b) => {
      if (a.open !== b.open) return a.open ? -1 : 1;
      return parseFloat(a.distance) - parseFloat(b.distance);
    });

    // Try to enrich with Supabase override data
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseKey) {
        const placeIds = results.map((r) => r.placeId).filter(Boolean);
        if (placeIds.length > 0) {
          const overrideRes = await fetch(
            `${supabaseUrl}/rest/v1/clinics?google_place_id=in.(${placeIds
              .map((id) => `"${id}"`)
              .join(",")})&select=google_place_id,services,insurance_tags`,
            {
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
              },
            }
          );

          if (overrideRes.ok) {
            const overrides: {
              google_place_id: string;
              services: string[];
              insurance_tags: string[];
            }[] = await overrideRes.json();

            for (const override of overrides) {
              const match = results.find(
                (r) => r.placeId === override.google_place_id
              );
              if (match) {
                if (override.services?.length)
                  match.services = override.services;
                if (override.insurance_tags?.length)
                  match.insurance = override.insurance_tags;
              }
            }
          }
        }
      }
    } catch (enrichErr) {
      // Supabase enrichment failure should not block results
      console.error("Supabase enrichment failed:", enrichErr);
    }

    // Cache raw results (before insurance filtering)
    cache.set(cacheKey, { results, timestamp: Date.now() });

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

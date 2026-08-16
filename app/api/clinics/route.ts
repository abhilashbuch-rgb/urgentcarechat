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
// Columns added by migrations after the original clinics table. PostgREST
// rejects an ENTIRE select when one named column doesn't exist, so naming
// these unconditionally means a database that hasn't caught up takes down
// every Supabase-backed feature at once — insurance tags, network boost,
// wait times, and tenant scoping — while the endpoint still returns 200
// with plausible-looking clinics. That exact failure was live: the AFC
// portal returned zero clinics because of it.
//
// So they're requested as extras: try the full set, and on rejection fall
// back to the columns the base schema guarantees. Clinics keep flowing and
// the extras light up on their own as migrations land.
const OPTIONAL_CLINIC_COLUMNS = [
  "brand",
  "current_wait_minutes",
  "wait_updated_at",
] as const;

async function selectClinicRows<T>(
  supabaseUrl: string,
  supabaseKey: string,
  filter: string,
  coreColumns: string[],
  optionalColumns: readonly string[]
): Promise<T[] | null> {
  const attempt = async (columns: string[]) => {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/clinics?${filter}&select=${columns.join(",")}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    return res.ok ? ((await res.json()) as T[]) : { status: res.status, body: await res.text() };
  };

  const full = await attempt([...coreColumns, ...optionalColumns]);
  if (Array.isArray(full)) return full;

  const core = await attempt(coreColumns);
  if (Array.isArray(core)) {
    console.warn(
      `[clinics] optional columns unavailable (${optionalColumns.join(
        ", "
      )}) — serving core fields only. Run supabase/schema.sql to enable them.`
    );
    return core;
  }

  console.error(
    "[clinics] Supabase rejected even the core select:",
    core.status,
    core.body.slice(0, 300)
  );
  return null;
}

async function enrichWithSupabase(results: PlaceResult[]): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Anon key FIRST, deliberately. These are public reads and RLS already
  // grants anon SELECT on clinics, so the elevated key buys nothing here —
  // but preferring it made every Supabase-backed feature depend on a
  // credential this endpoint doesn't need. When that key went stale in
  // production the result was a 401 on every query while the endpoint kept
  // returning 200 with plausible-looking clinics: insurance tags empty,
  // network boost dead, wait times gone, and tenant search returning zero.
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  const placeIds = results.map((r) => r.placeId).filter(Boolean);
  if (placeIds.length === 0) return;

  try {
    const overrides = await selectClinicRows<{
      google_place_id: string;
      services: string[];
      insurance_tags: string[];
      is_featured: boolean | null;
      brand?: string | null;
      current_wait_minutes?: number | null;
      wait_updated_at?: string | null;
    }>(
      supabaseUrl,
      supabaseKey,
      `google_place_id=in.(${placeIds.map((id) => `"${id}"`).join(",")})`,
      ["google_place_id", "services", "insurance_tags", "is_featured"],
      OPTIONAL_CLINIC_COLUMNS
    );

    if (!overrides) return;

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

      // `?? null` because these columns are optional: on a database that
      // predates the wait-time migration they're absent, not null.
      const waitMinutes = override.current_wait_minutes ?? null;
      match.waitMinutes =
        waitMinutes !== null && !isWaitStale(override.wait_updated_at ?? null)
          ? waitMinutes
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

// Live rating/hours/website for one known clinic, by Google Place ID
// (Place Details, not Text Search — Text Search has no way to filter
// to "just this chain's locations", which is the whole reason a
// tenant-scoped search can't just be a filtered version of the public one).
async function fetchPlaceDetails(placeId: string, apiKey: string) {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "formattedAddress,nationalPhoneNumber,rating,currentOpeningHours,websiteUri",
      },
    });
    if (!res.ok) return null;

    const place: {
      formattedAddress?: string;
      nationalPhoneNumber?: string;
      rating?: number;
      currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
      websiteUri?: string;
    } = await res.json();

    const hoursInfo = formatHoursStatus(place.currentOpeningHours);
    return {
      address: place.formattedAddress || "",
      phone: place.nationalPhoneNumber || "",
      rating: place.rating || 0,
      open: hoursInfo.open,
      hours: hoursInfo.hours,
      websiteUrl: place.websiteUri || "",
    };
  } catch {
    return null;
  }
}

// Tenant-scoped search (e.g. afc.urgentcare.chat): reads only that
// tenant's own clinics rows — never Google's broad "urgent care near
// X" search — since Google has no concept of "only AFC's locations".
async function handleTenantClinics(
  tenantSlug: string,
  centerLat: number,
  centerLng: number,
  apiKey: string,
  insurance: string | null
): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Anon key FIRST, deliberately. These are public reads and RLS already
  // grants anon SELECT on clinics, so the elevated key buys nothing here —
  // but preferring it made every Supabase-backed feature depend on a
  // credential this endpoint doesn't need. When that key went stale in
  // production the result was a 401 on every query while the endpoint kept
  // returning 200 with plausible-looking clinics: insurance tags empty,
  // network boost dead, wait times gone, and tenant search returning zero.
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ clinics: [] });
  }

  try {
    const rows = await selectClinicRows<{
      google_place_id: string | null;
      name: string;
      address: string | null;
      phone: string | null;
      lat: number | null;
      lng: number | null;
      services: string[];
      insurance_tags: string[];
      is_featured: boolean | null;
      current_wait_minutes?: number | null;
      wait_updated_at?: string | null;
    }>(
      supabaseUrl,
      supabaseKey,
      `tenant_slug=eq.${encodeURIComponent(tenantSlug)}`,
      [
        "google_place_id",
        "name",
        "address",
        "phone",
        "lat",
        "lng",
        "services",
        "insurance_tags",
        "is_featured",
      ],
      ["current_wait_minutes", "wait_updated_at"]
    );

    if (!rows) return NextResponse.json({ clinics: [] });

    const results: PlaceResult[] = await Promise.all(
      rows.map(async (row) => {
        const details = row.google_place_id
          ? await fetchPlaceDetails(row.google_place_id, apiKey)
          : null;

        const lat = row.lat ?? 0;
        const lng = row.lng ?? 0;
        const address = details?.address || row.address || "";

        return {
          name: row.name,
          address,
          phone: details?.phone || row.phone || "",
          lat,
          lng,
          rating: details?.rating ?? 0,
          open: details?.open ?? false,
          hours: details?.hours ?? "Call to confirm hours",
          placeId: row.google_place_id || "",
          distance: `${distanceMiles(centerLat, centerLng, lat, lng).toFixed(1)} mi`,
          services: row.services?.length ? row.services : [...DEFAULT_URGENT_CARE_SERVICES],
          insurance: row.insurance_tags || [],
          directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
            address || row.name
          )}${row.google_place_id ? `&destination_place_id=${row.google_place_id}` : ""}`,
          websiteUrl: details?.websiteUrl || "",
          featured: !!row.is_featured,
          network: false,
          // `?? null` — optional columns are absent, not null, on a
          // database that predates the wait-time migration.
          waitMinutes:
            (row.current_wait_minutes ?? null) !== null &&
            !isWaitStale(row.wait_updated_at ?? null)
              ? row.current_wait_minutes ?? null
              : null,
        };
      })
    );

    sortClinics(results);

    let filtered = results;
    if (insurance && insurance.toLowerCase() !== "skip" && insurance.toLowerCase() !== "none") {
      filtered = filterByInsurance(results, insurance);
    }

    return NextResponse.json({ clinics: filtered.slice(0, 5) });
  } catch (err) {
    console.error("Tenant clinics error:", err instanceof Error ? err.message : "Unknown");
    return NextResponse.json({ clinics: [] });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const zip = searchParams.get("zip");
  const insurance = searchParams.get("insurance");
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  // Set by proxy.ts when this request came in through a recognized
  // tenant subdomain (e.g. afc.urgentcare.chat) — routes to a completely
  // different, narrower lookup below instead of the public Google search.
  const tenantSlug = req.headers.get("x-tenant-slug");

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

    // Check cache first — but not for a tenant-scoped request. This
    // cache is keyed by zip only and holds public Google Places
    // results; a tenant's own clinics never go through it (see
    // handleTenantClinics below), so mixing the two would either leak
    // public results into a branded portal or pollute the public
    // cache with a single tenant's narrow view.
    if (!tenantSlug) {
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

  if (tenantSlug) {
    return handleTenantClinics(tenantSlug, centerLat, centerLng, apiKey, insurance);
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

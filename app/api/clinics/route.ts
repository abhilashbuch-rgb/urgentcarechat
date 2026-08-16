import { NextRequest, NextResponse } from "next/server";
import { distanceMiles } from "@/lib/geo";
import { isWaitStale } from "@/lib/wait-time";
import { getTenantBySlug } from "@/lib/tenants";

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

// Inside a tenant portal, rank by distance and nothing else.
//
// sortClinics above puts featured/paid placement first, which is the right
// behaviour for the public directory — that's the business model. It is the
// wrong behaviour here: every result already belongs to the same brand, so
// "featured" would only mean showing a patient a FARTHER location of the
// same chain than the one down the road. A branded portal answers one
// question — which of our locations is closest to you.
function sortByDistance(results: PlaceResult[]): void {
  results.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
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
// Every meaningful word of the brand's display name must appear in a
// result's name — not just the distinctive one.
//
// Matching on the distinctive token alone was actively dangerous: "AFC
// Urgent Care" reduced to "afc", and an Atlanta search returned "AFC
// (Automotive Finance Corp.)" — a car auction house — as a place to take a
// bleeding hand. Requiring "urgent" and "care" too is what separates the
// clinic from the company that happens to share an acronym.
//
// The generic words don't weaken the filter, because the distinctive word
// is still required alongside them: a plain "Urgent Care" without "afc"
// still fails.
const STOP_WORDS = new Set(["the", "and", "of", "at", "for", "a", "an", "&"]);

function brandTokens(displayName: string): string[] {
  const tokens = displayName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return tokens.length ? tokens : [displayName.toLowerCase()];
}

// Nothing beyond this is a usable answer to "where should I go right now".
// Before this cap, a Nashville search padded its list with the seeded
// Philadelphia rows at 680 miles.
const MAX_USEFUL_MILES = 100;

function withinRange(results: PlaceResult[]): PlaceResult[] {
  return results.filter(
    (r) => parseFloat(r.distance) <= MAX_USEFUL_MILES
  );
}

// Live, nationwide lookup of one brand's locations near a patient.
//
// The alternative — seeding every location into Supabase — doesn't scale to
// a franchise with hundreds of clinics and goes stale the moment one opens
// or closes. Searching Google for the brand name near the patient covers
// the entire chain from day one with no data entry, and Google keeps it
// current. Seeded rows still matter: they carry what Google doesn't have
// (insurance tags, wait times), merged in afterwards by place ID.
//
// Google returns generic urgent cares alongside the brand, so results are
// filtered to names containing every distinguishing token of the brand.
async function searchBrandLocations(
  displayName: string,
  tokens: string[],
  centerLat: number,
  centerLng: number,
  apiKey: string,
  radiusMeters: number
): Promise<PlaceResult[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.currentOpeningHours,places.location,places.websiteUri",
    },
    body: JSON.stringify({
      textQuery: displayName,
      locationBias: {
        circle: {
          center: { latitude: centerLat, longitude: centerLng },
          radius: radiusMeters,
        },
      },
      pageSize: 20,
    }),
  });

  if (!res.ok) {
    console.error(
      "[clinics] brand search failed:",
      res.status,
      (await res.text()).slice(0, 200)
    );
    return [];
  }

  const data = await res.json();
  const places: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    rating?: number;
    currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
    location?: { latitude?: number; longitude?: number };
    websiteUri?: string;
  }> = data.places || [];

  return places
    .filter((p) => {
      const name = (p.displayName?.text || "").toLowerCase();
      return tokens.every((t) => name.includes(t));
    })
    .map((place) => {
      const lat = place.location?.latitude || 0;
      const lng = place.location?.longitude || 0;
      const hoursInfo = formatHoursStatus(place.currentOpeningHours);
      const address = place.formattedAddress || "";
      return {
        name: place.displayName?.text || "Urgent Care",
        address,
        phone: place.nationalPhoneNumber || "",
        lat,
        lng,
        rating: place.rating || 0,
        open: hoursInfo.open,
        hours: hoursInfo.hours,
        placeId: place.id || "",
        distance: `${distanceMiles(centerLat, centerLng, lat, lng).toFixed(1)} mi`,
        services: [...DEFAULT_URGENT_CARE_SERVICES],
        insurance: [],
        directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
          address || place.displayName?.text || ""
        )}${place.id ? `&destination_place_id=${place.id}` : ""}`,
        websiteUrl: place.websiteUri || "",
        featured: false,
        network: false,
        waitMinutes: null,
      } satisfies PlaceResult;
    });
}

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

    const seeded: PlaceResult[] = await Promise.all(
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

    // Live brand search FIRST, so the portal covers the whole chain
    // nationwide rather than only the locations someone remembered to seed.
    // Seeded rows remain the fallback (and the source of insurance tags).
    const tenant = await getTenantBySlug(tenantSlug);
    let results = seeded;

    if (tenant) {
      const cfg = tenant.config.locations;
      const tokens = cfg?.nameIncludes?.length
        ? cfg.nameIncludes.map((t) => t.toLowerCase())
        : brandTokens(tenant.displayName);
      // Google Places caps circle.radius at 50,000 m and rejects the whole
      // request above it — which silently degraded every brand search to
      // the seeded-rows fallback. Clamped rather than validated so an
      // over-large config value is capped instead of invalidating the
      // tenant's entire config. locationBias only *weights* results, so a
      // 31-mile bias still surfaces the brand's locations further out.
      const PLACES_MAX_RADIUS_M = 50000;
      const radiusMeters = Math.min(
        PLACES_MAX_RADIUS_M,
        Math.round((cfg?.radiusMiles ?? 30) * 1609.34)
      );

      const live = await searchBrandLocations(
        cfg?.searchQuery || tenant.displayName,
        tokens,
        centerLat,
        centerLng,
        apiKey,
        radiusMeters
      );

      if (live.length > 0) {
        // Prefer live results, but keep any seeded location the search
        // missed so a hand-curated clinic never disappears.
        const seenIds = new Set(live.map((r) => r.placeId).filter(Boolean));
        const missed = seeded.filter((r) => r.placeId && !seenIds.has(r.placeId));
        results = [...live, ...missed];
        // Live results carry no insurance tags or wait times — those live in
        // our own table, merged back on by place ID.
        await enrichWithSupabase(results);
      }
    }

    sortByDistance(results);

    // An empty list is a better answer than a clinic in another state:
    // the chat says it found nothing nearby, which is true and useful.
    let filtered = withinRange(results);
    if (insurance && insurance.toLowerCase() !== "skip" && insurance.toLowerCase() !== "none") {
      filtered = filterByInsurance(filtered, insurance);
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

  // Two ways a request can be tenant-scoped:
  //   header — set by proxy.ts for a branded subdomain (afc.urgentcare.chat)
  //   query  — sent by the portal itself, which is also served at
  //            urgentcare.chat/<slug>, where /api/* is a reserved root path
  //            that proxy.ts passes through without tagging
  // Without the second, the path-based portal searched unscoped and showed
  // competitors inside a tenant's own branded page.
  const tenantSlug =
    req.headers.get("x-tenant-slug") || searchParams.get("tenant");

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

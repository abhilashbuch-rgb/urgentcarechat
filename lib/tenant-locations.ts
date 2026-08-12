// Reads a tenant's own locations straight out of Supabase by tenant_slug.
//
// Deliberately NOT /api/clinics: that endpoint answers "what's nearest to
// this visitor", which needs coordinates and ranks by distance. A tenant's
// "our locations" list is the full roster regardless of where the visitor
// is standing, so it's a plain table read.

export interface TenantLocation {
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  services: string[];
  lat: number | null;
  lng: number | null;
}

interface Row {
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  services: string[] | null;
  lat: number | null;
  lng: number | null;
}

export async function getTenantLocations(
  slug: string,
  limit = 50
): Promise<TenantLocation[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/clinics?tenant_slug=eq.${encodeURIComponent(
        slug
      )}&select=name,address,phone,website,rating,services,lat,lng&order=name.asc&limit=${limit}`,
      {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        // Locations change rarely; a stale-by-an-hour address is fine and
        // saves a round trip per visitor.
        next: { revalidate: 3600 },
      }
    );

    if (!res.ok) {
      console.error(
        "[tenant-locations] Supabase returned",
        res.status,
        await res.text().catch(() => "")
      );
      return [];
    }

    const rows: Row[] = await res.json();
    return rows.map((r) => ({
      name: r.name,
      address: r.address,
      phone: r.phone,
      website: r.website,
      rating: r.rating,
      services: r.services ?? [],
      lat: r.lat,
      lng: r.lng,
    }));
  } catch (err) {
    console.error(
      "[tenant-locations] fetch failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return [];
  }
}

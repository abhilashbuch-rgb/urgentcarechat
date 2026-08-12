// Looks up a branded-subdomain tenant (e.g. "afc" for afc.urgentcare.chat)
// by slug. Used by proxy.ts on every request (to decide whether to
// rewrite/redirect) and by app/t/[tenant]/layout.tsx (to theme the page),
// so this stays a plain read against the public "active tenants" RLS
// policy — no service_role key needed here.

import { parseTenantConfig, type TenantConfig } from "@/lib/tenant-config";

export interface Tenant {
  slug: string;
  displayName: string;
  primaryColor: string | null;
  logoUrl: string | null;
  /** Portal layout and copy, from tenants.config. Never null — an absent
   *  or invalid config resolves to the defaults. */
  config: TenantConfig;
}

interface CacheEntry {
  tenant: Tenant | null;
  expiresAt: number;
}

// Short TTL, not "never expires" — active/inactive and branding changes
// should show up within a minute without needing a redeploy.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.tenant;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let tenant: Tenant | null = null;

  if (supabaseUrl && supabaseKey) {
    // Two attempts, because code and schema deploy independently. If
    // tenants.config doesn't exist yet, PostgREST rejects the whole select
    // with a 400 — which would take a working tenant portal to a 404 until
    // someone ran the migration. Falling back to the column set that
    // definitely exists means deploy order doesn't matter: the portal comes
    // up on default config and picks up the real one once the migration
    // lands.
    let result = await fetchTenant(supabaseUrl, supabaseKey, slug, true);
    // Retry only when the query itself failed. A successful query that found
    // nothing means the slug isn't a tenant — asking again would just double
    // the traffic for every unrecognized subdomain proxy.ts sees.
    if (!result.queried) {
      result = await fetchTenant(supabaseUrl, supabaseKey, slug, false);
    }
    tenant = result.tenant;
  }

  cache.set(slug, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });
  return tenant;
}

/** `queried` distinguishes "the query ran" from "the query failed" — a
 *  successful lookup that found no row is a definite answer, not a retry. */
interface LookupResult {
  queried: boolean;
  tenant: Tenant | null;
}

async function fetchTenant(
  supabaseUrl: string,
  supabaseKey: string,
  slug: string,
  withConfig: boolean
): Promise<LookupResult> {
  const columns = `slug,display_name,primary_color,logo_url${
    withConfig ? ",config" : ""
  }`;

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/tenants?slug=eq.${encodeURIComponent(
        slug
      )}&active=is.true&select=${columns}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );

    if (!res.ok) {
      // Only worth shouting about on the fallback attempt — a failed
      // with-config attempt is the expected pre-migration case.
      if (!withConfig) {
        console.error(
          "[tenants] Supabase returned",
          res.status,
          await res.text().catch(() => "")
        );
      }
      return { queried: false, tenant: null };
    }

    const rows: {
      slug: string;
      display_name: string;
      primary_color: string | null;
      logo_url: string | null;
      config?: unknown;
    }[] = await res.json();

    const row = rows[0];
    if (!row) return { queried: true, tenant: null };

    return {
      queried: true,
      tenant: {
        slug: row.slug,
        displayName: row.display_name,
        primaryColor: row.primary_color,
        logoUrl: row.logo_url,
        config: parseTenantConfig(row.config ?? null),
      },
    };
  } catch (err) {
    console.error(
      "[tenants] lookup failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return { queried: false, tenant: null };
  }
}

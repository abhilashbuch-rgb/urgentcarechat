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
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/tenants?slug=eq.${encodeURIComponent(
          slug
        )}&active=is.true&select=slug,display_name,primary_color,logo_url,config`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        }
      );

      if (res.ok) {
        const rows: {
          slug: string;
          display_name: string;
          primary_color: string | null;
          logo_url: string | null;
          config: unknown;
        }[] = await res.json();

        const row = rows[0];
        if (row) {
          tenant = {
            slug: row.slug,
            displayName: row.display_name,
            primaryColor: row.primary_color,
            logoUrl: row.logo_url,
            config: parseTenantConfig(row.config),
          };
        }
      }
    } catch (err) {
      console.error("Tenant lookup failed:", err instanceof Error ? err.message : "Unknown");
    }
  }

  cache.set(slug, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });
  return tenant;
}

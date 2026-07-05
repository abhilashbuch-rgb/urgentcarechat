import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Session-aware server client (anon key, respects RLS) for the
// provider portal's server components and route handlers. Distinct
// from lib/supabase.ts's createServerClient, which uses the
// service_role key and bypasses RLS entirely — that one stays for
// admin/webhook routes; this one is for the logged-in provider's own
// session. Kept separate from lib/supabase-browser.ts because this
// file imports next/headers, which breaks client component bundles.
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — safe to ignore
            // since proxy.ts refreshes the session on every request.
          }
        },
      },
    }
  );
}

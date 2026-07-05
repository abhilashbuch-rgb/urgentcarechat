import { createBrowserClient } from "@supabase/ssr";

// Session-aware browser client (anon key, respects RLS) for the
// provider portal's client components. Kept in its own file, with no
// next/headers import, so client bundles never pull in server-only code.
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

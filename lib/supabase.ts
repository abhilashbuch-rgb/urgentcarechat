import { createClient } from "@supabase/supabase-js";

// Server-side client (uses service_role key — full access, never expose to browser)
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE env vars — check .env.local");
  }
  return createClient(url, key, {
    global: {
      // A ceiling, same reasoning as lib/mail.ts's and lib/twilio.ts's
      // own AbortSignal.timeout: supabase-js sets none on its own, so a
      // single hung request holds a cron invocation until the platform
      // kills it with an opaque Gateway Timeout instead of a real,
      // loggable error — which is exactly what /api/cron/send-follow-ups
      // was hitting daily before this existed. Every caller here is a
      // small, single-row-ish query; none has a legitimate reason to
      // run longer than this.
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
    },
  });
}

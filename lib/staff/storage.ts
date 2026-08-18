import { createClient } from "@supabase/supabase-js";

// Where an uploaded credential scan actually goes.
//
// SUPABASE STORAGE, NOT A POSTGRES COLUMN. Postgres is not a file
// server: a scanned licence in a bytea column is a row nobody can back
// up cheaply and a payload every query planner steps over.
//
// CONFIGURED-OR-HONEST. The bucket does not exist until somebody creates
// it, and this deployment may not have one. Rather than throwing a 500
// at a person who has just tried to upload their BLS card — which reads
// as "you did something wrong" — isStorageConfigured() lets the route
// answer 503 with a message that says the clinic has not turned uploads
// on yet, and lets the page keep offering the part that always works:
// recording the expiry date without the scan.
//
// A date with no file is worth far more than nothing. The roster can
// chase an expiry it knows about; it cannot chase one nobody entered
// because they had no scanner.

const BUCKET = "staff-credentials";

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("storage_not_configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Object key for one person's file. Namespaced by org AND user, so a
 *  path is never guessable across clinics and a listing scoped to a
 *  prefix cannot walk sideways into somebody else's shelf. */
export function keyFor(org: string, userId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  return `${org}/${userId}/${Date.now()}-${safe}`;
}

export async function putFile(
  key: string,
  body: ArrayBuffer,
  contentType: string
): Promise<void> {
  const { error } = await client()
    .storage.from(BUCKET)
    .upload(key, body, { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

/**
 * A short-lived link to read one file back.
 *
 * SIGNED AND SHORT, never a public URL. These are licences and
 * certification cards; a permanent public link to one is a permanent
 * public link to a document with somebody's full legal name on it, and
 * bucket URLs leak through browser history, chat logs and screenshots.
 * Ten minutes is long enough to open a PDF and short enough that a
 * leaked link is worthless by the time it travels.
 */
export async function signedUrl(key: string, seconds = 600): Promise<string> {
  const { data, error } = await client()
    .storage.from(BUCKET)
    .createSignedUrl(key, seconds);
  if (error || !data) throw new Error(error?.message ?? "sign_failed");
  return data.signedUrl;
}

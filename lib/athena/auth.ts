import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { withOrg } from "@/lib/staff/db";
import {
  athenaConfigured,
  athenaTokenUrl,
  AthenaApiError,
  type AthenaEnvironment,
} from "@/lib/athena/client";

/**
 * OAuth 2.0 client_credentials (2-legged) token exchange and caching for
 * athenahealth's background-sync flow.
 *
 * NOTHING HERE HAS EVER TALKED TO A REAL athenahealth SERVER. We do not
 * have ATHENA_CLIENT_ID/ATHENA_CLIENT_SECRET yet — sandbox credentials
 * are self-serve at developer.athenahealth.com, production access needs
 * their Marketplace partner program and a signed agreement, neither of
 * which is code's to obtain. Every function below is written against
 * athenahealth's documented OAuth2 token endpoint shape and is safe to
 * ship inert (athenaConfigured() below reports false and callers should
 * check it), but treat the token-exchange request/response shape as
 * unverified until it has actually round-tripped against Preview.
 *
 * ONLY THE 2-LEGGED FLOW. The original integration notes also call for
 * Authorization Code (3-legged) for individual staff SSO — a different
 * feature with per-person tokens, not built here. Don't extend this
 * file to hold both; give that its own module and its own table when
 * it's actually being built.
 */

const ENCRYPTION_ALGO = "aes-256-gcm";

function encryptionKey(): Buffer {
  const raw = process.env.ATHENA_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("ATHENA_TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ATHENA_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}); generate one with "openssl rand -base64 32"`
    );
  }
  return key;
}

/** iv (12 bytes) || ciphertext || auth tag (16 bytes), base64-encoded. */
function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGO, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

function decryptToken(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv(ENCRYPTION_ALGO, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export class AthenaNotConnectedError extends Error {
  constructor(org: string) {
    super(`No athenahealth connection is on file for org "${org}"`);
    this.name = "AthenaNotConnectedError";
  }
}

interface ConnectionRow {
  practice_id: string;
  environment: AthenaEnvironment;
  access_token_encrypted: string | null;
  access_token_expires_at: string | null;
}

/**
 * Registers (or re-registers) which practice an org is connected to.
 * Called once the callback route exists — not built yet — after a real
 * OAuth handshake resolves a practiceid. Left here now because it's the
 * write half of the same concern this file already owns, and has
 * nothing to do with the token endpoint itself.
 */
export async function recordConnection(
  org: string,
  practiceId: string,
  environment: AthenaEnvironment,
  connectedByUserId: string | null
): Promise<void> {
  await withOrg(org, "athena_sync", async (sql) => {
    await sql`
      insert into staff.athena_connections (org_slug, practice_id, environment, connected_by)
      values (${org}, ${practiceId}, ${environment}, ${connectedByUserId})
      on conflict (org_slug) do update
        set practice_id = excluded.practice_id,
            environment = excluded.environment,
            connected_by = excluded.connected_by,
            connected_at = now(),
            -- A re-connection invalidates whatever token was cached under
            -- the old practice/environment pairing.
            access_token_encrypted = null,
            access_token_expires_at = null
    `;
  });
}

/**
 * Returns a valid access token for the org's connected practice,
 * exchanging or refreshing against athenahealth when the cached one is
 * within 5 minutes of expiring or absent. Throws AthenaNotConnectedError
 * if the org has never been connected.
 */
export async function getAccessToken(org: string): Promise<string> {
  const row = await withOrg(org, "athena_sync", async (sql) => {
    const rows = await sql<ConnectionRow[]>`
      select practice_id, environment, access_token_encrypted,
             access_token_expires_at::text as access_token_expires_at
        from staff.athena_connections
       where org_slug = ${org}
    `;
    return rows[0] ?? null;
  });

  if (!row) throw new AthenaNotConnectedError(org);

  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const stillValid =
    row.access_token_encrypted &&
    row.access_token_expires_at &&
    new Date(row.access_token_expires_at).getTime() - Date.now() > FIVE_MINUTES_MS;

  if (stillValid) return decryptToken(row.access_token_encrypted!);

  return exchangeAndCache(org, row.practice_id, row.environment);
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

async function exchangeAndCache(
  org: string,
  practiceId: string,
  environment: AthenaEnvironment
): Promise<string> {
  if (!athenaConfigured()) {
    throw new Error("athenahealth is not configured (ATHENA_CLIENT_ID/SECRET/ENCRYPTION_KEY unset)");
  }

  const clientId = process.env.ATHENA_CLIENT_ID!;
  const clientSecret = process.env.ATHENA_CLIENT_SECRET!;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: `athena/service/Athenanet.MDP.${practiceId}`,
  });

  const res = await fetch(athenaTokenUrl(environment), {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AthenaApiError(`athenahealth token exchange failed: ${res.status}`, res.status, text);
  }

  const json = (await res.json()) as TokenResponse;
  const expiresAt = new Date(Date.now() + json.expires_in * 1000);

  await withOrg(org, "athena_sync", async (sql) => {
    await sql`
      update staff.athena_connections
         set access_token_encrypted = ${encryptToken(json.access_token)},
             access_token_expires_at = ${expiresAt.toISOString()}
       where org_slug = ${org}
    `;
  });

  return json.access_token;
}

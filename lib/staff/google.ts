// Google sign-in for the staff area — the authorization-code flow, done
// with two fetches.
//
// No auth library. The flow is one redirect and one token exchange, and
// the parts that actually need care (state, invite lookup, session
// signing) aren't the parts a library would do for us.
//
// IMPORTANT: signing in with Google proves identity only. Authorization is
// the invite check in the callback route — see staff.org_invites.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  /** The Google Workspace domain this account belongs to, from the `hd`
   *  claim. Absent for personal accounts — which is precisely what the
   *  hosted-domain restriction uses to tell them apart. */
  hostedDomain: string | null;
}

export function isConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
}

/**
 * The callback URL for this request's hostname.
 *
 * Derived from the host rather than fixed, because each org has its own
 * hostname (afc.urgentcare.chat) and OAuth requires the redirect_uri at
 * the token exchange to byte-match the one used at authorize time. The
 * operational cost is real and worth stating plainly: every staff
 * hostname must be listed as an authorized redirect URI in the Google
 * Cloud console before sign-in works there.
 */
export function callbackUrl(req: Request): string {
  const override = process.env.STAFF_OAUTH_REDIRECT_ORIGIN;
  if (override) return `${override.replace(/\/$/, "")}/api/staff/auth/callback`;

  const host = req.headers.get("host") ?? "";
  const scheme = host.startsWith("localhost") || host.startsWith("127.0.0.1")
    ? "http"
    : "https";
  return `${scheme}://${host}/api/staff/auth/callback`;
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    // Staff share workstations. Landing straight into whichever Google
    // account the browser saw last is how the wrong person ends up
    // signing a compliance log.
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<GoogleIdentity | null> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    console.error("[staff-auth] token exchange failed:", res.status, await res.text().catch(() => ""));
    return null;
  }

  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) return null;

  // The token came straight from Google's token endpoint over TLS in
  // response to our own client_secret, so its signature adds nothing here
  // — this is the one case Google's own docs say may skip verification.
  // (An id_token arriving from anywhere else would have to be verified
  // against Google's JWKS; none does in this flow.)
  const payload = decodeJwtPayload(body.id_token);
  if (!payload?.sub || !payload?.email) return null;

  return {
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name: payload.name ? String(payload.name) : null,
    hostedDomain: payload.hd ? String(payload.hd).toLowerCase() : null,
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

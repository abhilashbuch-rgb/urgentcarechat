/**
 * Low-level HTTP wrapper for athenahealth's v1 API.
 *
 * NOT WIRED TO ANYTHING LIVE YET. We don't have athenahealth developer
 * credentials as of writing this — see lib/athena/auth.ts's header for
 * what that blocks. This file is the piece that doesn't need them:
 * request/retry/rate-limit mechanics that are true regardless of which
 * practice or environment is calling.
 *
 * BASE URLS. athenahealth splits preview (sandbox) and production onto
 * different hosts, both scoped by practiceid in the path:
 *   preview:    https://api.preview.platform.athenahealth.com/v1/{practiceid}
 *   production: https://api.platform.athenahealth.com/v1/{practiceid}
 * Taken from athenahealth's published API Solutions docs, not verified
 * against a live call — there is nothing to call yet. Re-check this
 * against docs.athenahealth.com the day real sandbox credentials exist,
 * before trusting a single byte that comes back.
 */

export type AthenaEnvironment = "preview" | "production";

export function athenaConfigured(): boolean {
  return Boolean(
    process.env.ATHENA_CLIENT_ID &&
      process.env.ATHENA_CLIENT_SECRET &&
      process.env.ATHENA_TOKEN_ENCRYPTION_KEY
  );
}

export function athenaEnvironment(): AthenaEnvironment {
  return process.env.ATHENA_ENVIRONMENT === "production" ? "production" : "preview";
}

function baseUrl(env: AthenaEnvironment): string {
  return env === "production"
    ? "https://api.platform.athenahealth.com"
    : "https://api.preview.platform.athenahealth.com";
}

export function athenaApiUrl(env: AthenaEnvironment, practiceId: string, path: string): string {
  const trimmed = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl(env)}/v1/${practiceId}${trimmed}`;
}

export function athenaTokenUrl(env: AthenaEnvironment): string {
  return `${baseUrl(env)}/oauth2/v1/token`;
}

export class AthenaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = "AthenaApiError";
  }
}

/**
 * RATE LIMITING IS PER-PROCESS, NOT GLOBAL. athenahealth's stated limits
 * are 15 QPS on preview and 150 QPS on production, PER PRACTICE. A
 * serverless deployment runs many instances, each holding its own
 * counter here — this throttle keeps one instance polite, it does not
 * coordinate across instances. That's an honest gap, not a bug to hide:
 * the real backstop is the 429 handling below, which works no matter
 * how the limit gets hit.
 */
const lastRequestAt = new Map<string, number>();

function minIntervalMs(env: AthenaEnvironment): number {
  const qps = env === "production" ? 150 : 15;
  return 1000 / qps;
}

async function throttle(env: AthenaEnvironment, practiceId: string): Promise<void> {
  const key = `${env}:${practiceId}`;
  const now = Date.now();
  const last = lastRequestAt.get(key) ?? 0;
  const wait = last + minIntervalMs(env) - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt.set(key, Date.now());
}

/**
 * Full jitter backoff, per the AWS Architecture Blog's well-known
 * formula: random(0, base * 2^attempt), capped. Avoids every retrying
 * client waking up on the same tick after a shared rate-limit trip.
 */
function backoffMs(attempt: number): number {
  const base = 500;
  const cap = 8000;
  const max = Math.min(cap, base * 2 ** attempt);
  return Math.floor(Math.random() * max);
}

export interface AthenaRequestOptions {
  method?: string;
  body?: URLSearchParams | string;
  headers?: Record<string, string>;
}

/**
 * A single authenticated request against a practice-scoped endpoint,
 * with the QPS throttle above and up to 3 retries on 429 (Retry-After
 * honored when present, full-jitter backoff otherwise).
 */
export async function athenaRequest(
  env: AthenaEnvironment,
  practiceId: string,
  accessToken: string,
  path: string,
  options: AthenaRequestOptions = {}
): Promise<Response> {
  const url = athenaApiUrl(env, practiceId, path);
  const maxAttempts = 3;

  for (let attempt = 0; ; attempt++) {
    await throttle(env, practiceId);

    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
      body: options.body,
    });

    if (res.status !== 429 || attempt >= maxAttempts - 1) {
      if (!res.ok && res.status !== 429) {
        const text = await res.text().catch(() => "");
        throw new AthenaApiError(
          `athenahealth ${options.method ?? "GET"} ${path} failed: ${res.status}`,
          res.status,
          text
        );
      }
      return res;
    }

    const retryAfter = res.headers.get("retry-after");
    const delay = retryAfter ? Number(retryAfter) * 1000 : backoffMs(attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

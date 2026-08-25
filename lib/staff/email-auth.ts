import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { StaffSql } from "@/lib/staff/db";
import { withOrg } from "@/lib/staff/db";
import { ROOT_URL } from "@/lib/site";

// Proving you hold an email address, for clinics that are not on Google.
//
// THE INVITE IS STILL THE CONTROL. This proves possession of an address;
// it grants nothing. Whether that address may sign in is decided by
// staff.org_invites, exactly as it is on the Google path — see
// resolveInvite() below, which is the same query the OAuth callback runs.

const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The code is hashed WITH the address, so the same six digits issued to
 *  two people do not produce the same hash — and so a hash lifted from
 *  the table cannot be replayed against a different account. */
export function codeHash(email: string, code: string): string {
  return hash(`${email.toLowerCase()}:${code}`);
}

/** Six digits from a CSPRNG. randomInt, not Math.random — this is a
 *  credential, and Math.random is seeded predictably enough that a
 *  determined attacker can narrow the space considerably. */
export function mintCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface Challenge {
  /** Emailed as a link. */
  url: string;
  /** Emailed as six digits, for when the inbox is on another device. */
  code: string;
  expiresAt: Date;
}

/**
 * Issue a challenge for an address.
 *
 * ALWAYS SUCCEEDS, whether or not the address is invited. The caller
 * decides what to send; a route that threw here for an unknown address
 * would leak which addresses exist to anybody with the form.
 *
 * Any previous live token for the address is consumed first, so a code
 * requested twice leaves exactly one code that works — otherwise every
 * request would widen the attacker's target rather than replacing it.
 */
export async function issueChallenge(
  sql: StaffSql,
  args: { email: string; ip?: string | null; ua?: string | null }
): Promise<Challenge> {
  const email = args.email.trim().toLowerCase();
  const token = mintToken();
  const code = mintCode();

  await sql`
    update staff.email_auth_tokens
       set consumed_at = now()
     where lower(email) = ${email} and consumed_at is null
  `;

  const [row] = await sql<{ expires_at: string }[]>`
    insert into staff.email_auth_tokens
      (email, token_hash, code_hash, expires_at, requested_ip, requested_ua)
    values
      (${email}, ${hash(token)}, ${codeHash(email, code)},
       now() + make_interval(mins => ${TTL_MINUTES}),
       ${args.ip ?? null}, ${(args.ua ?? "").slice(0, 200) || null})
    returning expires_at::text as expires_at
  `;

  return {
    url: `${ROOT_URL}/staff/signin/link?t=${token}`,
    code,
    expiresAt: new Date(row.expires_at),
  };
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" | "too_many" };

/**
 * Redeem a link token or a typed code.
 *
 * NO SESSION EXISTS YET, so this runs with no org context — the org is
 * discovered from the invite afterwards, not supplied here.
 *
 * EVERY FAILURE RETURNS THE SAME SHAPE and the route renders the same
 * sentence for "invalid" and "expired". Distinguishing them tells an
 * attacker whether a code was ever real, which is the one bit worth
 * having when guessing.
 */
export async function verifyChallenge(
  input: { token?: string; email?: string; code?: string }
): Promise<VerifyResult> {
  return withOrg("", "signin", async (sql) => {
    // --- the link ---
    if (input.token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) {
        return { ok: false, reason: "invalid" } as const;
      }
      const rows = await sql<{ id: string; email: string; expired: boolean }[]>`
        select id, email, (expires_at <= now()) as expired
          from staff.email_auth_tokens
         where token_hash = ${hash(input.token)} and consumed_at is null
         limit 1
      `;
      const row = rows[0];
      if (!row) return { ok: false, reason: "invalid" } as const;
      if (row.expired) return { ok: false, reason: "expired" } as const;

      await sql`
        update staff.email_auth_tokens set consumed_at = now() where id = ${row.id}
      `;
      return { ok: true, email: row.email.toLowerCase() } as const;
    }

    // --- the typed code ---
    const email = (input.email ?? "").trim().toLowerCase();
    const code = (input.code ?? "").replace(/\D/g, "");
    if (!email || code.length !== 6) {
      return { ok: false, reason: "invalid" } as const;
    }

    const rows = await sql<
      { id: string; code_hash: string; attempts: number; expired: boolean }[]
    >`
      select id, code_hash, attempts, (expires_at <= now()) as expired
        from staff.email_auth_tokens
       where lower(email) = ${email} and consumed_at is null
       order by created_at desc
       limit 1
    `;
    const row = rows[0];
    if (!row) return { ok: false, reason: "invalid" } as const;
    if (row.expired) return { ok: false, reason: "expired" } as const;
    if (row.attempts >= MAX_ATTEMPTS) {
      return { ok: false, reason: "too_many" } as const;
    }

    const expected = Buffer.from(row.code_hash, "utf8");
    const actual = Buffer.from(codeHash(email, code), "utf8");
    const match =
      expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!match) {
      // The attempt is recorded BEFORE the failure is returned, so a
      // client that hangs up mid-request still spends its guess.
      await sql`
        update staff.email_auth_tokens
           set attempts = attempts + 1
         where id = ${row.id}
      `;
      return { ok: false, reason: "invalid" } as const;
    }

    await sql`
      update staff.email_auth_tokens set consumed_at = now() where id = ${row.id}
    `;
    return { ok: true, email } as const;
  });
}

export interface InviteMatch {
  org: string;
  role: string;
  jobRole: string | null;
  legalName: string | null;
}

export interface MemberMatch {
  org: string;
  personKey: string;
}

/**
 * Every ACTIVE account this address already signs into directly — at
 * most 2, same limit as the Google path's staff.resolve_signin() call,
 * for the same reason: the caller only needs to know whether there is
 * more than one, and if so whether the two share a person_key (a
 * deliberately linked account — see supabase/staff-multisite-worker.sql)
 * or a genuine collision to refuse.
 *
 * Called with a null google_sub, which staff.resolve_signin() treats as
 * "match by email only" — the same function the OAuth callback uses,
 * reused rather than duplicated so the two sign-in paths cannot drift
 * apart on who counts as an existing member.
 */
export async function resolveExistingMember(
  email: string
): Promise<MemberMatch[]> {
  const addr = email.trim().toLowerCase();
  return withOrg("", "staff", async (sql) => {
    const rows = await sql<{ org_slug: string; person_key: string }[]>`
      select org_slug, person_key
        from staff.resolve_signin(${addr}, null)
    `;
    return rows.map((r) => ({ org: r.org_slug, personKey: r.person_key }));
  });
}

/**
 * Which clinic, if any, has invited this address.
 *
 * THE SAME RULE AS THE GOOGLE CALLBACK: an invite naming the address
 * beats a blanket domain invite, so a named administrator is not demoted
 * to the domain's default role. Kept as one query rather than two so the
 * two sign-in paths cannot drift apart on who gets in.
 */
export async function resolveInvite(
  email: string
): Promise<InviteMatch | null> {
  const addr = email.trim().toLowerCase();

  return withOrg("", "signin", async (sql) => {
    // staff.invite_for_email is SECURITY DEFINER because there is no org
    // context at sign-in to scope RLS by — the org is the answer, not an
    // input. Querying staff.org_invites directly here returns zero rows,
    // which is the correct behaviour of the policy and was verified
    // rather than assumed. See supabase/staff-email-auth.sql.
    const rows = await sql<
      {
        org_slug: string;
        role: string;
        job_role: string | null;
        legal_name: string | null;
      }[]
    >`
      select org_slug, role, job_role, legal_name
        from staff.invite_for_email(${addr})
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      org: row.org_slug,
      role: row.role,
      jobRole: row.job_role,
      legalName: row.legal_name,
    };
  });
}

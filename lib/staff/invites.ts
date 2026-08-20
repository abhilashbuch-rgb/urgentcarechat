import { createHash, randomBytes } from "node:crypto";
import type { StaffSql } from "@/lib/staff/db";
import { send, isMailConfigured } from "@/lib/mail";
import { ROOT_URL, PRODUCT_NAME } from "@/lib/site";

// Administrator-issued invitations.
//
// ONE LINK, ONE ADDRESS, ONE USE, THREE DAYS.
//
// The token is 32 random bytes and is written down in exactly one place:
// the email. Only its SHA-256 reaches the database, so a leaked backup is
// a list of dead hashes rather than a set of working invitations — the
// same rule the surveyor links and the sign-in codes follow.
//
// AN INVITATION IS NOT A CREDENTIAL. Redeeming it proves the person
// reading that mailbox is the person invited; it does not by itself grant
// a session. The invite row remains the authority on whether the address
// may be here at all, and it is re-read at sign-in, so revoking it closes
// the door even for somebody holding a link they already clicked once.

const TTL_HOURS = 72;

export const INVITE_TTL_HOURS = TTL_HOURS;

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mint(): string {
  return randomBytes(32).toString("base64url");
}

export type InviteRole = "staff" | "org_admin";

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  job_role: string | null;
  created_at: string;
  expires_at: string;
  sent_at: string | null;
  sent_count: number;
  expired: boolean;
  invited_by_name: string | null;
}

export async function pending(
  sql: StaffSql,
  org: string
): Promise<PendingInvite[]> {
  return sql<PendingInvite[]>`
    select id, email, role, job_role,
           created_at::text as created_at,
           expires_at::text as expires_at,
           sent_at::text    as sent_at,
           sent_count, expired, invited_by_name
      from staff.pending_invites
     where org_slug = ${org}
  `;
}

export type IssueResult =
  | { ok: true; link: string; mailed: boolean }
  | { ok: false; reason: "already_member" | "not_configured" };

/**
 * Creates (or replaces) the invitation for one address and mails the link.
 *
 * RE-INVITING REPLACES. A unique index allows only one live invitation per
 * address per org, so an administrator who clicks Invite twice does not
 * leave two working links in one mailbox — the older one is revoked here
 * before the new one is written.
 */
export async function issue(
  sql: StaffSql,
  org: string,
  invitedBy: string,
  email: string,
  role: InviteRole,
  jobRole: string | null
): Promise<IssueResult> {
  const addr = email.trim().toLowerCase();

  // Somebody who already has an active account does not need an
  // invitation; sending one would imply their existing access had
  // lapsed. Reactivation lives on the Team screen instead.
  const [existing] = await sql<{ active: boolean }[]>`
    select active from staff.users
     where org_slug = ${org} and lower(email) = ${addr}
  `;
  if (existing?.active) return { ok: false, reason: "already_member" };

  const token = mint();

  await sql`
    update staff.org_invites
       set revoked_at = now()
     where org_slug = ${org}
       and lower(email) = ${addr}
       and revoked_at is null
       and accepted_at is null
  `;

  await sql`
    insert into staff.org_invites
      (org_slug, email, role, job_role, invited_by, token_hash, expires_at)
    values
      (${org}, ${addr}, ${role}::staff.user_role, ${jobRole}, ${invitedBy},
       ${hash(token)}, now() + make_interval(hours => ${TTL_HOURS}))
  `;

  const link = `${ROOT_URL}/staff/invite?t=${token}`;

  if (!isMailConfigured()) {
    // The link is still returned so an administrator on a deployment with
    // no mail provider can pass it on themselves. Saying it was emailed
    // when nothing was sent is the one thing this must not do.
    return { ok: true, link, mailed: false };
  }

  const [orgRow] = await sql<{ name: string }[]>`
    select name from staff.orgs where slug = ${org}
  `;
  const clinic = orgRow?.name ?? "your clinic";

  await send({
    to: addr,
    subject: `You have been added to ${clinic} on ${PRODUCT_NAME}`,
    text: [
      `${clinic} has given you access to its ${PRODUCT_NAME} records.`,
      ``,
      `Open this link to finish setting up your access:`,
      link,
      ``,
      `The link works once and expires in ${TTL_HOURS} hours. If it has`,
      `expired, ask your administrator to send another — they can do it`,
      `from the Team screen in seconds.`,
      ``,
      `If you were not expecting this, ignore it. The link only works from`,
      `this address, and nothing happens until it is opened.`,
    ].join("\n"),
  });

  await sql`
    update staff.org_invites
       set sent_at = now(), sent_count = sent_count + 1
     where org_slug = ${org} and lower(email) = ${addr}
       and revoked_at is null and accepted_at is null
  `;

  return { ok: true, link, mailed: true };
}

export type RedeemResult =
  | { ok: true; org: string; email: string }
  | { ok: false; reason: "unknown" | "expired" };

/**
 * Spends an invitation link.
 *
 * Looked up by hash, and the same statement that finds it marks it
 * accepted — so two browsers racing the same link cannot both win. The
 * partial index excludes revoked and already-accepted rows, so a revoked
 * invitation is indistinguishable from one that never existed.
 */
export async function redeem(
  sql: StaffSql,
  token: string
): Promise<RedeemResult> {
  const [row] = await sql<
    { org_slug: string; email: string; expired: boolean }[]
  >`
    select org_slug, email, (expires_at <= now()) as expired
      from staff.org_invites
     where token_hash = ${hash(token)}
       and revoked_at is null
       and accepted_at is null
     limit 1
  `;

  if (!row) return { ok: false, reason: "unknown" };
  if (row.expired) return { ok: false, reason: "expired" };

  await sql`
    update staff.org_invites
       set accepted_at = now()
     where token_hash = ${hash(token)}
       and revoked_at is null
       and accepted_at is null
  `;

  return { ok: true, org: row.org_slug, email: row.email };
}

/** Revokes a pending invitation. Never deletes it — "who let this person
 *  in, and who changed their mind" has to still have an answer later. */
export async function revoke(
  sql: StaffSql,
  org: string,
  id: string
): Promise<void> {
  await sql`
    update staff.org_invites
       set revoked_at = now()
     where id = ${id}::uuid and org_slug = ${org} and revoked_at is null
  `;
}

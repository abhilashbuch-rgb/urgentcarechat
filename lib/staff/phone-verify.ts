import type { StaffSql } from "@/lib/staff/db";
import { isSmsConfigured, sendSms } from "@/lib/twilio";

// A phone number a person typed in is a claim, not a fact — this is
// what turns it into one: a six-digit code sent to the number itself,
// checked back against what they type. See supabase/staff-phone-
// verify.sql for the columns this reads and writes; this file is
// their only writer.

const OTP_TTL_MINUTES = 10;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

// Matches the DB CHECK constraint and every other E.164 validator in
// this codebase (see app/api/staff/settings/route.ts's isE164) —
// deliberately the same pattern everywhere a phone number is accepted.
const E164 = /^\+[1-9][0-9]{7,14}$/;

export function isValidPhone(phone: string): boolean {
  return E164.test(phone);
}

function genCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export type StartOtpResult =
  | { ok: true }
  | { ok: false; error: "invalid_phone" | "not_configured" | "too_soon" | "send_failed" };

/**
 * Save the number, and text it a fresh code. Always overwrites any
 * number already on file — a person correcting a typo should not have
 * to clear the old one first — and always clears phone_verified_at,
 * because that flag means "we proved THIS number," never "we proved A
 * number once."
 */
export async function startPhoneVerification(
  sql: StaffSql,
  userId: string,
  phone: string
): Promise<StartOtpResult> {
  if (!isValidPhone(phone)) return { ok: false, error: "invalid_phone" };
  if (!isSmsConfigured()) return { ok: false, error: "not_configured" };

  const [existing] = await sql<{ phone_otp_sent_at: string | null }[]>`
    select phone_otp_sent_at::text as phone_otp_sent_at
      from staff.users where id = ${userId}
  `;
  if (existing?.phone_otp_sent_at) {
    const elapsedMs = Date.now() - new Date(existing.phone_otp_sent_at).getTime();
    if (elapsedMs < OTP_RESEND_SECONDS * 1000) return { ok: false, error: "too_soon" };
  }

  const code = genCode();
  try {
    await sendSms(
      phone,
      `Your medicin.io verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`
    );
  } catch {
    // Never save a number this send has already proven unreachable —
    // an unconfirmed row for a bad number would sit there looking like
    // progress toward the "every member has a phone" goal when it is
    // not.
    return { ok: false, error: "send_failed" };
  }

  await sql`
    update staff.users
       set phone = ${phone},
           phone_verified_at = null,
           phone_otp_code = ${code},
           phone_otp_expires_at = now() + (${OTP_TTL_MINUTES} || ' minutes')::interval,
           phone_otp_attempts = 0,
           phone_otp_sent_at = now()
     where id = ${userId}
  `;
  return { ok: true };
}

export type ConfirmOtpResult =
  | { ok: true }
  | { ok: false; error: "no_pending" | "expired" | "too_many_attempts" | "mismatch" };

/** Check a typed code against the pending one. Five wrong guesses and
 *  the code is dead — see OTP_MAX_ATTEMPTS — but the number itself is
 *  untouched, so requesting a fresh code always works and simply
 *  resets the counter. */
export async function confirmPhoneVerification(
  sql: StaffSql,
  userId: string,
  code: string
): Promise<ConfirmOtpResult> {
  const [row] = await sql<
    { phone_otp_code: string | null; phone_otp_expires_at: string | null; phone_otp_attempts: number }[]
  >`
    select phone_otp_code, phone_otp_expires_at::text as phone_otp_expires_at, phone_otp_attempts
      from staff.users where id = ${userId}
  `;
  if (!row?.phone_otp_code || !row.phone_otp_expires_at) return { ok: false, error: "no_pending" };
  if (new Date(row.phone_otp_expires_at).getTime() < Date.now()) return { ok: false, error: "expired" };
  if (row.phone_otp_attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "too_many_attempts" };

  if (row.phone_otp_code !== code.trim()) {
    await sql`update staff.users set phone_otp_attempts = phone_otp_attempts + 1 where id = ${userId}`;
    return { ok: false, error: "mismatch" };
  }

  await sql`
    update staff.users
       set phone_verified_at = now(),
           phone_otp_code = null,
           phone_otp_expires_at = null,
           phone_otp_attempts = 0
     where id = ${userId}
  `;
  return { ok: true };
}

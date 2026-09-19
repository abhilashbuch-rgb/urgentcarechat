-- ============================================================
-- EVERY STAFF MEMBER GETS THEIR OWN VERIFIED PHONE NUMBER
--
-- staff.users.phone has existed since the original schema but nothing
-- in the product ever wrote or read it -- there was no self-serve way
-- for a person to add their own number, and no proof a number typed in
-- actually reaches them. This adds that proof: a one-time code sent to
-- the number itself (lib/staff/phone-verify.ts, the only writer of
-- these five columns), and phone_verified_at is set only once that
-- code comes back correctly.
--
-- Changing the number always clears phone_verified_at -- see
-- startPhoneVerification()'s own update. A verified badge must mean
-- "we proved THIS number," never "we proved A number, once."
--
-- staff.users.phone is null for every row in production as of this
-- migration, so the new check constraint below cannot fail against
-- real data -- confirmed directly before writing this file.
-- ============================================================

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_users_phone_e164'
  ) then
    alter table staff.users
      add constraint staff_users_phone_e164
      check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end $$;

alter table staff.users add column if not exists phone_verified_at timestamptz;
alter table staff.users add column if not exists phone_otp_code text;
alter table staff.users add column if not exists phone_otp_expires_at timestamptz;
alter table staff.users add column if not exists phone_otp_attempts int not null default 0;
alter table staff.users add column if not exists phone_otp_sent_at timestamptz;

comment on column staff.users.phone_verified_at is
  'Set only after this exact number answered its own one-time code -- '
  'see lib/staff/phone-verify.ts. Cleared the instant the number on '
  'file changes, so a verified badge never outlives the number it '
  'was proven against.';

comment on column staff.users.phone_otp_code is
  'The pending six-digit code, plaintext. Short-lived (10 minutes) and '
  'low value if leaked -- unlike a password, knowing it only lets '
  'someone confirm a phone number they would need to physically hold '
  'anyway to receive it in the first place.';

comment on column staff.users.phone_otp_sent_at is
  'Throttles resends -- see PHONE_OTP_RESEND_SECONDS in '
  'lib/staff/phone-verify.ts. Without this, a mistyped number lets '
  'someone hammer the send button and run up a real Twilio bill.';

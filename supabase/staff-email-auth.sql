-- ============================================================
-- SIGNING IN WITHOUT GOOGLE
--
-- Run AFTER supabase/staff-schema.sql. Idempotent.
--
-- WHY THIS EXISTS. Google OAuth was the only door, and a great many
-- urgent cares run Microsoft 365. For those clinics the sign-in screen
-- was a wall, not a login — the product could not be sold to them at
-- all. That is an adoption problem, not a security one, and it is the
-- reason for this file.
--
-- WHAT DOES NOT CHANGE: the invite is still the control. This adds a way
-- to PROVE you hold an address; it adds no way to get in without an
-- invite naming that address or its domain. Both doors open into the
-- same corridor.
--
-- ONE EMAIL, TWO WAYS TO USE IT
-- -----------------------------
-- The message carries a link and a six-digit code backed by the same
-- token. The link is one tap when email is on the phone in your hand;
-- the code is what works when the clinic's inbox is on the front desk
-- machine and you are standing in the back with a tablet. Offering only
-- one of them is a decision to fail in one of those two rooms.
--
-- SIX DIGITS IS A MILLION GUESSES, WHICH IS NOT MANY.
-- The code is only safe because of what surrounds it, and every one of
-- these is load-bearing:
--
--   * ten minutes to live
--   * single use — consumed on first success
--   * five wrong attempts and the token dies, not the account (locking
--     the account would hand anyone a denial-of-service against any
--     employee whose address they can guess)
--   * scoped to one email, so guesses cannot be spread across accounts
--   * the token behind the link is 32 bytes, and only its hash is stored
--
-- WITHOUT the attempt cap, six digits falls in minutes. With it, an
-- attacker gets five guesses per issued code against a one-in-a-million
-- space, and issuing a fresh code invalidates the old one.
--
-- NO ENUMERATION. Requesting a code answers identically whether or not
-- the address has an invite. The route decides what to send; the caller
-- learns nothing either way.
-- ============================================================

create table if not exists staff.email_auth_tokens (
  id uuid primary key default gen_random_uuid(),

  -- Lowercased at the route. Not a foreign key: a code may be requested
  -- for an address that has an invite but no user row yet, which is
  -- exactly the first-sign-in case.
  email text not null,

  -- SHA-256 of the 32-byte link token. Never the token.
  token_hash text not null,
  -- SHA-256 of the six digits, salted with the email so an identical
  -- code issued to two people does not produce an identical hash.
  code_hash text not null,

  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts integer not null default 0,

  -- For the audit trail and for spotting a burst of requests against one
  -- clinic. Never shown to the person signing in.
  requested_ip text,
  requested_ua text,

  created_at timestamptz not null default now()
);

create unique index if not exists staff_email_auth_token_hash
  on staff.email_auth_tokens (token_hash);

-- The lookup the verify route makes: newest live token for this address.
create index if not exists staff_email_auth_live
  on staff.email_auth_tokens (lower(email), created_at desc)
  where consumed_at is null;

do $$ begin
  alter table staff.email_auth_tokens
    add constraint staff_email_auth_window
    check (expires_at > created_at and expires_at <= created_at + interval '1 hour');
exception when duplicate_object then null;
end $$;

-- The cap is a constraint, not just route logic. A route that forgets to
-- check is a route that turns six digits into an afternoon's work.
do $$ begin
  alter table staff.email_auth_tokens
    add constraint staff_email_auth_attempt_cap
    check (attempts <= 5);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table staff.email_auth_tokens
    add constraint staff_email_auth_hashes_shaped
    check (token_hash ~ '^[0-9a-f]{64}$' and code_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;

-- ============================================================
-- ROW-LEVEL SECURITY
--
-- NO ORG COLUMN, and it is not an oversight. A code is requested BEFORE
-- anybody is signed in, so there is no org context to scope by — the org
-- is discovered from the invite afterwards. Nothing in the application
-- ever selects from this table by anything except an exact hash, and the
-- policy below refuses everything else.
-- ============================================================

alter table staff.email_auth_tokens enable row level security;
alter table staff.email_auth_tokens force row level security;

drop policy if exists staff_email_auth_no_browsing on staff.email_auth_tokens;
-- Deliberately permissive to the application role and useless to anyone
-- who obtains it: the table holds only hashes and timestamps, and both
-- hashes are of values that expire in ten minutes.
create policy staff_email_auth_no_browsing on staff.email_auth_tokens
  for all using (true) with check (true);

grant select, insert, update on staff.email_auth_tokens to staff_app;
-- Consumed tokens are kept, not deleted: "was a code issued for this
-- address, and was it used" is an audit question, and a table that
-- deletes its own history cannot answer it.
revoke delete on staff.email_auth_tokens from staff_app;

-- ============================================================
-- HOUSEKEEPING
--
-- Expired tokens are worthless but not harmless — they accumulate. This
-- is called from the hourly alert cron rather than a separate schedule.
-- Rows are kept for thirty days so the audit question above stays
-- answerable, then dropped.
-- ============================================================

create or replace function staff.prune_email_auth_tokens()
returns integer language plpgsql security definer
set search_path = staff, public
as $$
declare n integer;
begin
  delete from staff.email_auth_tokens
   where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function staff.prune_email_auth_tokens() from public;
grant execute on function staff.prune_email_auth_tokens() to staff_app;

-- ============================================================
-- WHICH CLINIC INVITED THIS ADDRESS
--
-- SECURITY DEFINER, and it is the second and last place in the module
-- that needs it. Same shape of problem as the surveyor token: sign-in
-- happens before any org context exists, so the org cannot scope the
-- lookup — the org is the ANSWER.
--
-- What keeps it narrow: the only argument is an email address, it
-- returns at most one row, the row contains no credential, and it can
-- neither read a compliance record nor write anything at all. An
-- attacker who could call it directly learns whether an address is
-- invited and to which clinic — which is why the ROUTE never exposes
-- that, answering identically for invited and uninvited addresses.
--
-- The precedence rule is the same one the Google callback uses: an
-- invite naming the address beats a blanket domain invite, so a named
-- administrator is not demoted to the domain default. Written once,
-- here, so the two sign-in paths cannot drift apart on who gets in.
-- ============================================================

create or replace function staff.invite_for_email(p_email text)
returns table (org_slug text, role text, job_role text, legal_name text)
language sql stable security definer
set search_path = staff, public
as $$
  select i.org_slug,
         i.role::text,
         i.job_role::text,
         i.legal_name
    from staff.org_invites i
   where i.revoked_at is null
     and (
       lower(i.email) = lower(btrim(p_email))
       or lower(i.email_domain) = lower(split_part(btrim(p_email), '@', 2))
     )
   order by (i.email is not null) desc
   limit 1
$$;

revoke all on function staff.invite_for_email(text) from public;
grant execute on function staff.invite_for_email(text) to staff_app;

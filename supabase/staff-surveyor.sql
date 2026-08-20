-- ============================================================
-- THE SURVEYOR LINK
--
-- Run AFTER supabase/staff-credentials.sql. Idempotent.
--
-- WHY THIS EXISTS AT ALL: the homepage has been advertising it for
-- months. "One read-only link, time-limited, for the inspector's iPad."
-- A feature promised on a sales page and absent from the product is a
-- lie told to every visitor, and it was the oldest outstanding one here.
--
-- WHAT IT IS. An inspector arrives unannounced. Somebody senior presses
-- a button, hands over an iPad, and the inspector sees the compliance
-- record and nothing else — no billing, no team administration, no
-- settings, no way to write anything. The link stops working by itself.
--
-- THE TOKEN IS NOT STORED
-- -----------------------
-- Only its SHA-256 is. The token exists in exactly two places: the URL
-- handed to the inspector, and the response that created it. A database
-- dump therefore yields no working links, which matters because this is
-- a bearer credential with no second factor — anyone holding the URL is
-- the inspector as far as the system is concerned.
--
-- That also means a lost link cannot be recovered, only reissued. That
-- is the correct trade: reissuing takes one press, and a recoverable
-- bearer token is one an administrator can be socially engineered into
-- reading out.
--
-- NOT GATED BY READ-ONLY BILLING, and this is the sharpest case for that
-- rule in the whole product. The failure mode being avoided: card
-- declines, webhook fires, access locks, and the clinic fails a state
-- inspection because it cannot show logs it already recorded. A billing
-- dispute must never become a regulatory finding.
-- ============================================================

create table if not exists staff.surveyor_tokens (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  -- SHA-256 of the token, hex. Never the token.
  token_hash text not null,

  -- Who this was issued to, in words: 'PA DOH, unannounced' or
  -- 'UCA accreditation'. A surveyor link with no label is an audit entry
  -- that cannot answer "who did you give access to in March".
  label text not null,

  expires_at timestamptz not null,

  created_by uuid references staff.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Revoking is instant and one-way. An inspector who leaves early, or a
  -- link sent to the wrong address, must be closable without waiting for
  -- the clock.
  revoked_at timestamptz,
  revoked_by uuid references staff.users(id) on delete set null,

  -- Was it actually opened, and how often. Answers "did the inspector
  -- use the link we gave them" long after everyone has forgotten.
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  view_count integer not null default 0
);

create unique index if not exists staff_surveyor_tokens_hash
  on staff.surveyor_tokens (token_hash);

create index if not exists staff_surveyor_tokens_live
  on staff.surveyor_tokens (org_slug, expires_at desc)
  where revoked_at is null;

-- A window, not a standing key. Anything beyond seven days is a
-- permanent credential with a distant expiry date, which is the shape
-- every leaked-token incident has. Two days covers an unannounced
-- inspection; a longer engagement gets a second link, which is also a
-- second audit row.
do $$ begin
  alter table staff.surveyor_tokens
    add constraint staff_surveyor_window
    check (expires_at > created_at and expires_at <= created_at + interval '7 days');
exception when duplicate_object then null;
end $$;

-- Revoked by whom, and when — both or neither.
do $$ begin
  alter table staff.surveyor_tokens
    add constraint staff_surveyor_revocation_complete
    check ((revoked_at is null) = (revoked_by is null));
exception when duplicate_object then null;
end $$;

-- A hash that is not a hash is a token stored in the clear under a
-- column named to look like it is not.
do $$ begin
  alter table staff.surveyor_tokens
    add constraint staff_surveyor_hash_shaped
    check (token_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;

alter table staff.surveyor_tokens enable row level security;
alter table staff.surveyor_tokens force row level security;

drop policy if exists staff_org_isolation on staff.surveyor_tokens;
create policy staff_org_isolation on staff.surveyor_tokens
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.surveyor_tokens to staff_app;
-- Never deleted. "Who was given access to this clinic's records, and
-- when" is a question with no expiry date of its own.
revoke delete on staff.surveyor_tokens from staff_app;

-- ============================================================
-- REDEEMING A TOKEN
--
-- SECURITY DEFINER, and this is the one place in the module that needs
-- it. A surveyor has no session and therefore no org context, so the
-- lookup has to happen before RLS can be scoped — the org is the ANSWER
-- to this function, not an input to it.
--
-- What makes that safe rather than a hole: the only argument is a
-- 64-character hash, the function returns one org slug or nothing, and
-- it can neither read a compliance record nor write one. The caller then
-- sets that org as its context and reads everything else under ordinary
-- RLS as a non-admin.
--
-- Expiry and revocation are evaluated HERE, in the same statement that
-- resolves the token, so there is no window in which application code
-- holds a valid-looking org from an expired link.
-- ============================================================

create or replace function staff.redeem_surveyor_token(p_hash text)
returns table (org_slug text, label text, expires_at timestamptz)
language plpgsql security definer
set search_path = staff, public
as $$
begin
  return query
  update staff.surveyor_tokens t
     set view_count = t.view_count + 1,
         first_seen_at = coalesce(t.first_seen_at, now()),
         last_seen_at = now()
   where t.token_hash = p_hash
     and t.revoked_at is null
     and t.expires_at > now()
  returning t.org_slug, t.label, t.expires_at;
end $$;

revoke all on function staff.redeem_surveyor_token(text) from public;
grant execute on function staff.redeem_surveyor_token(text) to staff_app;

-- ============================================================
-- WHAT THE INSPECTOR SEES
--
-- One row per issued link, for the administrator who issued them. The
-- token is absent by construction — there is no column holding it.
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break a re-run.
-- ============================================================

drop view if exists staff.surveyor_access cascade;
create view staff.surveyor_access
with (security_invoker = true) as
select
  t.id,
  t.org_slug,
  t.label,
  t.created_at,
  t.expires_at,
  t.revoked_at,
  t.first_seen_at,
  t.last_seen_at,
  t.view_count,
  c.legal_name as created_by_name,
  r.legal_name as revoked_by_name,
  case
    when t.revoked_at is not null   then 'revoked'
    when t.expires_at <= now()      then 'expired'
    when t.first_seen_at is null    then 'unopened'
    else 'active'
  end as state,
  greatest(0, extract(epoch from (t.expires_at - now()))::int) as seconds_left
from staff.surveyor_tokens t
left join staff.users c on c.id = t.created_by
left join staff.users r on r.id = t.revoked_by;

grant select on staff.surveyor_access to staff_app;

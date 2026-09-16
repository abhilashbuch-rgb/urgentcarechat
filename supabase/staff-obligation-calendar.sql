-- ============================================================
-- OBLIGATION CALENDAR — a subscribable feed, not a Google account
--
-- Run AFTER supabase/staff-obligations.sql and staff-surveyor.sql.
-- Idempotent.
--
-- WHY THIS SHAPE. The ask was "the sharps/waste-pickup date should show
-- up on the centre admin's and the MA's calendar." Two ways to get
-- there: have each person connect their own Google account (OAuth app
-- registration, a consent screen, and — for the calendar scope Google
-- treats as sensitive — an app-verification review that can take days),
-- or hand out a URL that any calendar app subscribes to once and polls
-- on its own. The second gets the same practical result today, with a
-- bearer link this module already knows how to issue safely — see
-- staff-surveyor.sql, which this borrows its shape from almost exactly.
--
-- ONE OBLIGATION KEY PER TOKEN, NOT THE WHOLE REGISTER. /staff/obligations
-- is clinical_lead and above; an MA cannot see it today, and a calendar
-- link is not the place to quietly widen that. A token names one
-- obligation (its KEY, e.g. 'rmw-pickup') and the feed exposes only that
-- one due date, so handing a link to an MA discloses exactly the one
-- thing this was asked for, not the register a clinical lead sees.
--
-- KEY, NOT id. Completing a recurring obligation INSERTS A NEW ROW for
-- the next occurrence (see staff.obligations_roll_forward()) — the id a
-- token was issued against would go stale the very next time somebody
-- finished the task. The key is stable across occurrences by design, so
-- the token names that instead and the feed always resolves to whichever
-- row is CURRENTLY open under it.
--
-- NO EXPIRY, UNLIKE A SURVEYOR LINK. An inspector's link is a stranger
-- handed temporary access to a building; a calendar subscription is a
-- standing fixture in someone's own calendar app, expected to keep
-- working indefinitely until an administrator revokes it. Revocable,
-- never time-boxed.
-- ============================================================

create table if not exists staff.obligation_calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  -- staff.obligations.key — see the header above for why this is the
  -- key and not a specific row id.
  key text not null,

  -- SHA-256 of the token, hex. Never the token.
  token_hash text not null,

  -- Who this was issued to, in words: 'MA — front desk tablet' or
  -- 'Jordan's phone'. Same reasoning as staff.surveyor_tokens.label.
  label text not null,

  created_by uuid references staff.users(id) on delete set null,
  created_at timestamptz not null default now(),

  revoked_at timestamptz,
  revoked_by uuid references staff.users(id) on delete set null,

  -- Was the feed ever actually fetched, and how often. A calendar app
  -- polls this on its own schedule (commonly once a day), so
  -- "never fetched" after a week is the sign the link was never added.
  first_fetched_at timestamptz,
  last_fetched_at timestamptz,
  fetch_count integer not null default 0
);

create unique index if not exists staff_obligation_calendar_tokens_hash
  on staff.obligation_calendar_tokens (token_hash);

create index if not exists staff_obligation_calendar_tokens_key
  on staff.obligation_calendar_tokens (org_slug, key)
  where revoked_at is null;

do $$ begin
  alter table staff.obligation_calendar_tokens
    add constraint staff_obligation_calendar_revocation_complete
    check ((revoked_at is null) = (revoked_by is null));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table staff.obligation_calendar_tokens
    add constraint staff_obligation_calendar_hash_shaped
    check (token_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null; end $$;

alter table staff.obligation_calendar_tokens enable row level security;
alter table staff.obligation_calendar_tokens force row level security;

drop policy if exists staff_org_isolation on staff.obligation_calendar_tokens;
create policy staff_org_isolation on staff.obligation_calendar_tokens
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.obligation_calendar_tokens to staff_app;
-- Never deleted, same reasoning as surveyor tokens: "who was given this
-- clinic's pickup schedule, and when" should not have an expiry date of
-- its own just because the link was revoked.
revoke delete on staff.obligation_calendar_tokens from staff_app;

-- ============================================================
-- REDEEMING A TOKEN — SECURITY DEFINER, same reasoning as
-- staff.redeem_surveyor_token(). A calendar app has no session and
-- therefore no org context; the org and key are the ANSWER to this
-- function, not an input to it. Revocation is evaluated in the same
-- statement that resolves the token.
-- ============================================================

create or replace function staff.redeem_calendar_token(p_hash text)
returns table (org_slug text, key text, label text)
language plpgsql security definer
set search_path = staff, public
as $$
begin
  return query
  update staff.obligation_calendar_tokens t
     set fetch_count = t.fetch_count + 1,
         first_fetched_at = coalesce(t.first_fetched_at, now()),
         last_fetched_at = now()
   where t.token_hash = p_hash
     and t.revoked_at is null
  returning t.org_slug, t.key, t.label;
end $$;

revoke all on function staff.redeem_calendar_token(text) from public;
grant execute on function staff.redeem_calendar_token(text) to staff_app;

-- ============================================================
-- WHAT THE ADMINISTRATOR SEES — one row per issued link. The token is
-- absent by construction. security_invoker so it reads under the
-- caller's own org context.
-- ============================================================

drop view if exists staff.obligation_calendar_access cascade;
create view staff.obligation_calendar_access
with (security_invoker = true) as
select
  t.id,
  t.org_slug,
  t.key,
  t.label,
  t.created_at,
  t.revoked_at,
  t.first_fetched_at,
  t.last_fetched_at,
  t.fetch_count,
  c.legal_name as created_by_name,
  r.legal_name as revoked_by_name,
  case
    when t.revoked_at is not null   then 'revoked'
    when t.first_fetched_at is null then 'unopened'
    else 'active'
  end as state
from staff.obligation_calendar_tokens t
left join staff.users c on c.id = t.created_by
left join staff.users r on r.id = t.revoked_by;

grant select on staff.obligation_calendar_access to staff_app;

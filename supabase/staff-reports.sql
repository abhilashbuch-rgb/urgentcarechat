-- ============================================================
-- SCHEDULED LOG REPORTS
--
-- Run AFTER supabase/staff-alerts.sql and staff-surveyor.sql. Idempotent.
--
-- The owner wants the week's logs to arrive without asking for them, at a
-- cadence they choose, with every timestamp and every name on it. Daily,
-- weekly, monthly, or all three at once for somebody who wants the daily
-- AND the roll-up.
--
-- ---------------------------------------------------------------
-- A LINK, NOT AN ATTACHMENT. This was the design question.
-- ---------------------------------------------------------------
-- These reports name people. Who filed what, at what minute, from how far
-- away, and what they wrote in a corrective action. An emailed PDF of
-- that lives in an inbox permanently, syncs to every phone on the
-- account, gets forwarded, and sits in backups nobody controls. It cannot
-- be recalled when an administrator leaves or a center changes hands.
--
-- A tokened link can be expired and revoked, and it records whether
-- anybody actually opened it — which an attachment never can. It also
-- reuses the surveyor-token design in staff-surveyor.sql, which is
-- already proven here: the token is never stored, only its SHA-256, so a
-- database dump yields no working links.
--
-- THE FRICTION OBJECTION IS REAL, so the email carries the headline
-- numbers in its body — filed, missed, out of range, off site. An owner
-- whose week was clean never has to click anything. The link is for the
-- week that was not.
--
-- ---------------------------------------------------------------
-- THE PDF IS NOT STORED. It is rendered when the link is opened.
-- ---------------------------------------------------------------
-- Storing generated files would mean a storage bucket, a cleanup job for
-- expired ones, and a permanent question about whether the stored copy
-- still matches the record. Rendering on open needs none of that: the row
-- below holds only the PERIOD, and the report is built from the live
-- tables each time. The binder renderer already does 90 days in ~200ms,
-- so a week is not worth caching.
--
-- It also means a corrected record shows corrected. A stored PDF from
-- Monday would keep asserting Monday's version of events after an
-- amendment, which is the opposite of what a compliance record is for.
-- ============================================================

-- ---------- 1. Who gets what, how often ----------

-- ONE ROW PER (org, email, cadence), NOT one row per person with three
-- booleans. Each cadence has its own last_sent_at and its own next due
-- date, and somebody who wants daily and monthly genuinely wants two
-- independent schedules — collapsing them into one row means one
-- last_sent_at doing two jobs and a daily send suppressing the monthly.
create table if not exists staff.report_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  -- An address, not a user id. The owner who wants the weekly report may
  -- not have a staff account at all, and requiring one to receive a PDF
  -- would mean provisioning logins for accountants and franchise
  -- managers who should never see the inside of the app.
  email text not null,

  -- A name for the report's greeting and for the audit trail.
  label text,

  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),

  -- Local hour to send, 0-23, in the ORG's timezone. Default 7 so the
  -- daily lands before the clinic opens and the weekly lands with Monday
  -- morning coffee.
  send_hour integer not null default 7 check (send_hour between 0 and 23),

  -- Weekly only: 0 = Sunday .. 6 = Saturday, matching Postgres dow.
  -- Default 1 (Monday) so a weekly report covers a finished week.
  send_dow integer check (send_dow between 0 and 6),

  -- Monthly only: day of month. Capped at 28 so no cadence silently skips
  -- February — a subscription set to the 31st would fire seven times a
  -- year and the owner would never know which months it missed.
  send_dom integer check (send_dom between 1 and 28),

  active boolean not null default true,

  -- The last period this subscription was sent for. Compared against the
  -- period that is currently due, which is what makes the sweep
  -- idempotent: a cron that fires twice, or a retry after a timeout,
  -- cannot send the same report twice.
  last_period_end date,
  last_sent_at timestamptz,

  created_by uuid references staff.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- One subscription per address per cadence per org. Re-subscribing is
  -- an update, not a second email arriving twice every morning.
  unique (org_slug, email, cadence)
);

-- The shape each cadence actually needs, enforced rather than assumed. A
-- weekly row with no day-of-week has no defined send time, and a monthly
-- row carrying a day-of-week is a row somebody edited from weekly and
-- half-finished.
do $$ begin
  alter table staff.report_subscriptions add constraint staff_report_sub_shape
    check (
      (cadence = 'daily'   and send_dow is null     and send_dom is null)
      or (cadence = 'weekly'  and send_dow is not null and send_dom is null)
      or (cadence = 'monthly' and send_dow is null     and send_dom is not null)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table staff.report_subscriptions add constraint staff_report_sub_email
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$');
exception when duplicate_object then null; end $$;

create index if not exists staff_report_subs_due
  on staff.report_subscriptions (org_slug, cadence) where active;


-- ---------- 2. What was sent, and was it opened ----------

create table if not exists staff.report_runs (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  subscription_id uuid references staff.report_subscriptions(id) on delete set null,

  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),

  -- The window the report covers, inclusive. Stored rather than derived
  -- so a report opened in a year still renders the period it was sent
  -- for, not a period recomputed from today.
  period_start date not null,
  period_end   date not null,

  -- SHA-256 of the link token, hex. Never the token itself.
  token_hash text not null,
  expires_at timestamptz not null,

  sent_to text not null,
  sent_at timestamptz,
  -- Null until delivery is attempted; set when the provider accepts it.
  send_error text,

  -- Was it read. Answers "does the owner actually look at these" a year
  -- later, which is the question that decides whether this feature earns
  -- its place.
  viewed_count integer not null default 0,
  last_viewed_at timestamptz,

  revoked_at timestamptz,

  created_at timestamptz not null default now(),

  constraint staff_report_period check (period_end >= period_start)
);

do $$ begin
  alter table staff.report_runs add constraint staff_report_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null; end $$;

-- A window is only ever sent once per subscription. The unique index is
-- what makes that true regardless of how many times a cron retries.
create unique index if not exists staff_report_runs_once
  on staff.report_runs (subscription_id, period_end)
  where subscription_id is not null;

create index if not exists staff_report_runs_token
  on staff.report_runs (token_hash);

create index if not exists staff_report_runs_org
  on staff.report_runs (org_slug, created_at desc);


-- ---------- 3. Which period is due right now ----------

-- Returns the period a cadence should cover if it is due at this moment
-- in the org's timezone, or no row if it is not due.
--
-- COMPLETED PERIODS ONLY. A daily report sent at 07:00 covers YESTERDAY,
-- not the morning it is sent in. A weekly one covers the week that ended,
-- not the one in progress. Sending a partial period would produce a
-- report whose "3 logs filed" means nothing, and an owner who learns the
-- numbers are partial stops reading them.
--
-- STABLE, not immutable: it reads the org's timezone.
create or replace function staff.report_period_due(
  p_org text, p_cadence text, p_send_hour integer,
  p_send_dow integer, p_send_dom integer, p_at timestamptz default now()
) returns table (period_start date, period_end date)
language plpgsql stable
as $$
declare
  tz    text;
  local timestamp;
begin
  select timezone into tz from staff.orgs where slug = p_org;
  if tz is null then tz := 'America/New_York'; end if;

  local := p_at at time zone tz;

  -- Not the send hour yet, so nothing is due. Compared on the hour rather
  -- than the minute because the sweep runs hourly; a subscription set to
  -- 07:00 fires on the 07:00 sweep whenever within that hour it lands.
  if extract(hour from local)::integer <> p_send_hour then
    return;
  end if;

  if p_cadence = 'daily' then
    return query select (local::date - 1), (local::date - 1);

  elsif p_cadence = 'weekly' then
    if extract(dow from local)::integer <> p_send_dow then return; end if;
    -- The seven days ending yesterday.
    return query select (local::date - 7), (local::date - 1);

  elsif p_cadence = 'monthly' then
    if extract(day from local)::integer <> p_send_dom then return; end if;
    -- The whole of last calendar month, regardless of which day of this
    -- month the subscription fires on. A "monthly" report covering the
    -- 30 days before the 12th is not a month anybody can reconcile
    -- against anything else.
    return query
      select (date_trunc('month', local::date) - interval '1 month')::date,
             (date_trunc('month', local::date) - interval '1 day')::date;
  end if;
end $$;

revoke all on function staff.report_period_due(text, text, integer, integer, integer, timestamptz) from public;
grant execute on function staff.report_period_due(text, text, integer, integer, integer, timestamptz) to staff_app;


-- ---------- 4. What goes in the report ----------

-- Every filing in a window with everything a reader needs to judge it:
-- who, when to the minute, whether it was in range, what they did about
-- it if not, and where they filed it from.
--
-- security_invoker so it is read under the caller's RLS, and dropped
-- first because CREATE OR REPLACE VIEW can only append columns.
drop view if exists staff.report_log_rows cascade;
create view staff.report_log_rows
with (security_invoker = true)
as
select r.id,
       r.org_slug,
       i.due_date,
       t.name          as form_name,
       t.slug          as form_slug,
       t.category,
       i.slot,
       r.submitted_at,
       u.legal_name    as filed_by,
       r.has_out_of_range,
       r.out_of_range_fields,
       r.corrective_action,
       r.location_status,
       round(r.filed_distance_m)::integer as distance_m,
       r.answers_json
  from staff.form_responses r
  join staff.form_instances i on i.id = r.instance_id
  join staff.form_templates t on t.id = i.template_id
  left join staff.users u     on u.id = r.submitted_by
 order by i.due_date, t.sort_order, i.slot;

grant select on staff.report_log_rows to staff_app;

-- The headline numbers that go in the EMAIL BODY, so a clean period needs
-- no click. Deliberately a handful of integers and nothing else: an owner
-- reading this on a phone is answering one question, which is whether
-- they need to look further.
drop view if exists staff.report_totals cascade;
create view staff.report_totals
with (security_invoker = true)
as
select r.org_slug,
       i.due_date,
       count(*)                                        as filed,
       count(*) filter (where r.has_out_of_range)       as out_of_range,
       count(*) filter (where r.location_status = 'off_site') as off_site,
       count(distinct r.submitted_by)                  as people
  from staff.form_responses r
  join staff.form_instances i on i.id = r.instance_id
 group by r.org_slug, i.due_date;

grant select on staff.report_totals to staff_app;

-- DELETE IS REVOKED, UPDATE IS NOT — and the distinction is the point.
-- A report run must stay updatable because two things are written after
-- the row is created: sent_at once the mail provider accepts it, and the
-- view counter each time the link is opened. Revoking update would have
-- made the view counter silently impossible, which is the same mistake
-- the obligations table made once already (see staff-security.sql: the
-- schema's ALTER DEFAULT PRIVILEGES grants delete on every future table,
-- so each one needs its own explicit revoke).
--
-- Deleting is what must not happen. A delivery history with rows removed
-- is not a delivery history.
grant select, insert, update on staff.report_runs to staff_app;
revoke delete on staff.report_runs from staff_app;
grant select, insert, update, delete on staff.report_subscriptions to staff_app;

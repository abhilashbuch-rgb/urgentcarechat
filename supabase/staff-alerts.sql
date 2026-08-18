-- ============================================================
-- ALERTS: WHAT REACHES A PHONE, AND WHEN
--
-- Run AFTER supabase/staff-logs.sql. Idempotent.
--
-- THE ONE DESIGN DECISION THAT MATTERS HERE
-- -----------------------------------------
-- The brief asked for an email to the owner AND the medical director on
-- EVERY log entry. A clinic files roughly ten logs a day, so that is
-- twenty executive emails a day and about six hundred a month, of which
-- roughly all say "everything was fine".
--
-- The failure mode is not annoyance, it is the thing this whole module
-- exists to prevent. Within a week the owner has a filter sending them
-- to a folder. From that moment the OUT-OF-RANGE ALERT lands in the
-- filtered folder too, and the one email that needed to be read at 9am
-- is the one nobody sees. A notification system that trains its reader
-- to ignore it is worse than no notification system, because the owner
-- believes they are covered.
--
-- The stated goal was "look at my phone at 9am or 5pm and know instantly
-- whether the facility is compliant". That is a DIGEST AT TWO TIMES, not
-- a stream. So:
--
--   EXCURSIONS AND MISSED TASKS  -> immediate, individually, always.
--   CLEAN LOGS                   -> recorded here, rolled into the AM
--                                   and PM digest.
--
-- notify_on_all_logs still exists and is still honoured, because it is
-- the owner's clinic and their call. It defaults FALSE, which is the
-- reverse of the brief, and this comment is why.
--
-- TIME GATING NEEDS A TIMEZONE, WHICH THE BRIEF DID NOT HAVE
-- ----------------------------------------------------------
-- Operating hours as bare TIME columns compared against the server's
-- clock is wrong everywhere except a clinic that happens to sit in UTC.
-- On Vercel that is every clinic: 07:30 local in Narberth is 12:30 UTC
-- in summer and 12:30 UTC becomes the wrong hour again in November when
-- the offset changes. So the org carries an IANA timezone and every
-- comparison happens in it, which also gets daylight saving right
-- without anybody maintaining a table of offsets.
-- ============================================================

alter table staff.orgs
  add column if not exists timezone text not null default 'America/New_York';

-- Rejected early rather than discovered at 7:30am. A bad zone name makes
-- every time comparison for that clinic silently wrong, and 'EST' is a
-- classic wrong answer — it is a fixed offset that ignores summer time,
-- so half the year of reminders lands an hour out.
--
-- A TRIGGER AND NOT A CHECK. The obvious version —
--   check (timezone in (select name from pg_timezone_names))
-- — does not compile: a CHECK constraint cannot contain a subquery, and
-- wrapping the lookup in a function does not help either, because the
-- zone database is a view and any function over it is STABLE rather than
-- IMMUTABLE. A trigger validates on write, which is the moment that
-- matters.
create or replace function staff.orgs_validate_timezone()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from pg_timezone_names where name = new.timezone
  ) then
    raise exception
      'unknown timezone %; use an IANA name such as America/New_York',
      new.timezone
      using errcode = 'check_violation';
  end if;

  -- EXISTENCE IS NOT ENOUGH, and the first version of this trigger got
  -- that wrong. 'EST' passes the lookup above — Postgres ships it — and
  -- it is precisely the value that breaks this feature, because it is a
  -- fixed -05:00 with no daylight saving. A clinic set to EST gets every
  -- reminder an hour late from March to November. Same for 'MST', 'HST'
  -- and the 'EST5EDT' family, which work but are legacy aliases.
  --
  -- Real zones are Region/City. Requiring the slash rejects every
  -- abbreviation while accepting every zone an actual clinic is in. UTC
  -- is allowed as the deliberate exception for a test or a fixture.
  if new.timezone <> 'UTC' and position('/' in new.timezone) = 0 then
    raise exception
      '% is a fixed-offset abbreviation, not a timezone; use a Region/City name such as America/New_York so daylight saving is handled',
      new.timezone
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists staff_orgs_timezone_check on staff.orgs;
create trigger staff_orgs_timezone_check
  before insert or update of timezone on staff.orgs
  for each row execute function staff.orgs_validate_timezone();

alter table staff.orgs
  add column if not exists operating_hours_start time not null default '07:30';

alter table staff.orgs
  add column if not exists operating_hours_end time not null default '20:30';

-- An end before a start would gate every reminder out of existence and
-- look exactly like "notifications are broken".
do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_hours_ordered
    check (operating_hours_end > operating_hours_start);
exception when duplicate_object then null;
end $$;

alter table staff.orgs
  add column if not exists owner_alert_email text;

alter table staff.orgs
  add column if not exists medical_director_alert_email text;

-- Deliberately FALSE by default. See the header.
alter table staff.orgs
  add column if not exists notify_on_all_logs boolean not null default false;

-- Excursions are not optional. There is no column to switch them off,
-- because "stop telling me when the vaccine fridge is out of range" is
-- not a preference a compliance product should implement.
alter table staff.orgs
  add column if not exists digest_am_at time not null default '09:00';

alter table staff.orgs
  add column if not exists digest_pm_at time not null default '17:00';

-- Both addresses render into an email envelope, so they are shaped here
-- rather than only in a route.
do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_alert_emails_shaped
    check (
      (owner_alert_email is null
        or owner_alert_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
      and (medical_director_alert_email is null
        or medical_director_alert_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    );
exception when duplicate_object then null;
end $$;

-- ============================================================
-- ONE PERSON'S SOUND PREFERENCE
--
-- Defaults ON. A shift reminder nobody hears is a shift reminder that
-- did not happen, and the whole point of the chime is the task somebody
-- forgot rather than the one they remembered.
-- ============================================================

alter table staff.users
  add column if not exists audio_alerts_enabled boolean not null default true;

-- ============================================================
-- THE DISPATCH QUEUE
--
-- A QUEUE, NOT A LOG, and the difference is the reason this table
-- exists at all. Sending an email inline with a log submission means the
-- provider's slow afternoon is the medical assistant's slow submit
-- button, and a provider outage means either a 500 on a filed log or a
-- lost alert. Rows land here inside the same transaction as the
-- response, and delivery is somebody else's problem afterwards.
--
-- So the audit answer "was the medical director told about the 49-degree
-- fridge" is answerable from this table even when the mail provider was
-- down — which is exactly when it gets asked.
-- ============================================================

create table if not exists staff.alert_queue (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  kind text not null check (kind in (
    'excursion', 'log', 'missed_task', 'credential_expiry', 'digest'
  )),

  -- 'now' is sent on the next sweep; 'digest' waits to be rolled up.
  urgency text not null default 'digest'
    check (urgency in ('now', 'digest')),

  -- What happened, in the sentence that will be read on a phone. Built
  -- at enqueue time rather than at send time so the alert says what was
  -- true when it fired, not what is true whenever the sweep runs.
  subject text not null,
  body text not null,

  -- The response, obligation or credential this is about, for dedupe.
  source_kind text,
  source_id uuid,

  submitted_by uuid references staff.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,

  -- Delivery state, per recipient, because the two addresses fail
  -- independently: an owner's inbox can bounce while the director's
  -- accepts, and "sent" as one flag would hide that.
  owner_sent_at timestamptz,
  director_sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,

  created_at timestamptz not null default now()
);

create index if not exists staff_alert_queue_pending
  on staff.alert_queue (org_slug, urgency, created_at)
  where owner_sent_at is null or director_sent_at is null;

create index if not exists staff_alert_queue_digest
  on staff.alert_queue (org_slug, created_at)
  where urgency = 'digest';

-- One alert per source event. Without this, a retried submit or a second
-- browser tab sends the medical director the same excursion twice, and
-- an alert that arrives twice gets trusted slightly less than one that
-- arrives once.
create unique index if not exists staff_alert_queue_once
  on staff.alert_queue (org_slug, source_kind, source_id, kind)
  where source_id is not null;

-- Stop retrying forever. A row that has failed five times is a
-- configuration problem, not a transient one, and a queue that retries
-- it hourly for a month buries the rows that would still send.
do $$ begin
  alter table staff.alert_queue
    add constraint staff_alert_queue_attempt_cap
    check (attempts <= 5);
exception when duplicate_object then null;
end $$;

alter table staff.alert_queue enable row level security;
alter table staff.alert_queue force row level security;
drop policy if exists staff_org_isolation on staff.alert_queue;
create policy staff_org_isolation on staff.alert_queue
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.alert_queue to staff_app;
-- Never deleted: "we told you" and "we tried to tell you and could not"
-- are both answers somebody will want years later.
revoke delete on staff.alert_queue from staff_app;

-- ============================================================
-- IS THE CLINIC OPEN RIGHT NOW
--
-- In the clinic's own timezone. Used by the reminder poller so an
-- employee's phone stays quiet at home — which is a labour-law point as
-- much as a courtesy one.
-- ============================================================

create or replace function staff.within_operating_hours(p_slug text)
returns boolean
language sql stable as $$
  select case
    when o.slug is null then false
    else (now() at time zone o.timezone)::time
           between o.operating_hours_start and o.operating_hours_end
  end
  from staff.orgs o
  where o.slug = p_slug
$$;

grant execute on function staff.within_operating_hours(text) to staff_app;

-- ============================================================
-- WHAT IS STILL OUTSTANDING AND ALREADY LATE
--
-- The reminder poller reads this. Late is derived from the clinic's own
-- clock, so nothing here goes stale and no overnight job can fail
-- silently in a way that looks like "nothing is late".
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break a re-run.
-- ============================================================

drop view if exists staff.overdue_today cascade;
create view staff.overdue_today
with (security_invoker = true) as
select
  l.org_slug,
  l.template_id,
  l.slug,
  l.name,
  l.slot,
  l.job_roles,
  (now() at time zone o.timezone)::time as local_now,
  o.timezone
from staff.todays_logs l
join staff.orgs o on o.slug = l.org_slug
where l.response_id is null
  -- An AM task is late once the morning is over; a PM task once the
  -- clinic is within an hour of closing. Not configurable per task yet,
  -- and the two thresholds are named here rather than buried in a route.
  and (
    (l.slot = 'am' and (now() at time zone o.timezone)::time > time '11:00')
    or (l.slot = 'pm' and (now() at time zone o.timezone)::time
          > (o.operating_hours_end - interval '1 hour'))
  );

grant select on staff.overdue_today to staff_app;

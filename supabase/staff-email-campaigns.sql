-- ============================================================
-- OUTBOUND EMAIL CAMPAIGNS: multi-step cold outreach, replacing
-- Constant Contact for B2B sequences (e.g. the med spa outreach list).
--
-- Run AFTER supabase/staff-schema.sql. Idempotent.
--
-- NOT ORG-SCOPED, ON PURPOSE. A campaign recipient is a prospect, not a
-- clinic — there is no org_slug to isolate by, because the org this
-- data belongs to doesn't exist yet. It lives entirely outside the
-- multi-tenant RLS model every other staff.* table uses.
--
-- WRITTEN, ONCE, DIRECTLY AGAINST PRODUCTION BEFORE THIS FILE EXISTED.
-- This file exists to bring the repo's migration history in sync with
-- what is already live, including a fix: the tables were first created
-- with RLS policies scoped `to service_role`, a Postgres role this
-- app's own connection never authenticates as (see lib/staff/db.ts's
-- header on why STAFF_DATABASE_URL is deliberately a non-superuser
-- role, staff_app). That made every one of these tables unreachable
-- from the app as originally written — reads returned nothing, writes
-- threw a row-security violation, and the whole feature would have
-- looked like it shipped clean and then silently done nothing. Fixed
-- here to the same shape as staff.stripe_events and
-- staff.email_auth_tokens: policy `to public`, qual `true` — this
-- table has no per-session identity to scope by, the same way those
-- two don't either.
--
-- SENDING IDENTITY IS DELIBERATELY SEPARATE FROM ALERT_FROM_EMAIL. See
-- lib/mail.ts's isOutreachConfigured() and app/api/cron/send-campaign-
-- emails/route.ts — a spam complaint on a cold-outreach send must
-- never be able to degrade the sender reputation a compliance alert
-- (an out-of-range fridge, an EOD report) depends on.
-- ============================================================

create table if not exists staff.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists staff.email_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references staff.email_campaigns(id) on delete cascade,
  step_number integer not null,
  -- Days after the PREVIOUS step was sent, not after enrollment — step
  -- 1's own delay_days is 0 (send on enrollment), step 2's is measured
  -- from step 1's send, and so on. See sendCampaignBatch() in
  -- lib/staff/campaigns.ts for where this is actually applied.
  delay_days integer not null default 0,
  subject text not null,
  html_body text not null,
  created_at timestamptz not null default now(),
  unique (campaign_id, step_number)
);

create table if not exists staff.email_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references staff.email_campaigns(id) on delete cascade,
  email text not null,
  company_name text,
  city text,
  state text,
  -- The unsubscribe link's whole credential — see app/api/unsubscribe/
  -- route.ts. Unguessable and unique; RLS on this table is
  -- unrestricted (see below), so the token itself is what stands
  -- between "know this one recipient's link" and "change this one
  -- recipient's status", same security shape as
  -- staff.email_auth_tokens.
  unsubscribe_token text not null default encode(gen_random_bytes(16), 'hex'),
  status text not null default 'active'
    check (status in ('active', 'unsubscribed', 'bounced', 'completed', 'failed')),
  current_step integer not null default 0,
  next_send_at timestamptz not null default now(),
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, email)
);

create index if not exists email_recipients_due_idx
  on staff.email_recipients (status, next_send_at)
  where status = 'active';

create unique index if not exists email_recipients_unsub_token_idx
  on staff.email_recipients (unsubscribe_token);

create table if not exists staff.email_sends (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references staff.email_recipients(id) on delete cascade,
  step_number integer not null,
  sent_at timestamptz not null default now(),
  status text not null check (status in ('sent', 'failed')),
  error text
);

create index if not exists email_sends_recipient_idx
  on staff.email_sends (recipient_id);

-- See the header: `to public, using (true)` because this data has no
-- per-session identity to check against, the same shape already
-- proven in production by staff.stripe_events and
-- staff.email_auth_tokens — not a `service_role`-only policy, which
-- staff_app (this app's actual connection role) is never a member of.
alter table staff.email_campaigns enable row level security;
alter table staff.email_campaign_steps enable row level security;
alter table staff.email_recipients enable row level security;
alter table staff.email_sends enable row level security;

alter table staff.email_campaigns force row level security;
alter table staff.email_campaign_steps force row level security;
alter table staff.email_recipients force row level security;
alter table staff.email_sends force row level security;

drop policy if exists staff_email_campaigns_app on staff.email_campaigns;
create policy staff_email_campaigns_app on staff.email_campaigns
  for all to public using (true) with check (true);

drop policy if exists staff_email_campaign_steps_app on staff.email_campaign_steps;
create policy staff_email_campaign_steps_app on staff.email_campaign_steps
  for all to public using (true) with check (true);

drop policy if exists staff_email_recipients_app on staff.email_recipients;
create policy staff_email_recipients_app on staff.email_recipients
  for all to public using (true) with check (true);

drop policy if exists staff_email_sends_app on staff.email_sends;
create policy staff_email_sends_app on staff.email_sends
  for all to public using (true) with check (true);

grant select, insert, update, delete on staff.email_campaigns to staff_app;
grant select, insert, update, delete on staff.email_campaign_steps to staff_app;
grant select, insert, update, delete on staff.email_recipients to staff_app;
grant select, insert, update, delete on staff.email_sends to staff_app;

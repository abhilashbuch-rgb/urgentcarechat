-- ============================================================
-- urgentcare.chat — Database Schema
-- Run this in Supabase SQL Editor: Dashboard > SQL Editor > New query
-- ============================================================

-- 1. CLINICS — override layer on top of Google Places
create table if not exists clinics (
  id              uuid primary key default gen_random_uuid(),
  google_place_id text unique,
  name            text not null,
  address         text,
  phone           text,
  website         text,
  lat             float8,
  lng             float8,
  zip             text,
  hours_json      jsonb,
  services        text[] default '{}',
  insurance_tags  text[] default '{}',
  is_featured     boolean default false,   -- reserved for future use (v2)
  featured_until  timestamptz,             -- reserved for future use (v2)
  rating          float4,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Index for zip-based lookups
create index if not exists idx_clinics_zip on clinics(zip);

-- 2. CLICKS — analytics (no PII)
create table if not exists clicks (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid references clinics(id),
  clinic_name     text,
  session_id      text,
  event_type      text not null,       -- 'directions', 'call', 'website'
  referrer_zip    text,
  created_at      timestamptz default now()
);

-- 3. CONVERSATIONS — de-identified, QA only, 30-day TTL
create table if not exists conversations (
  id                  uuid primary key default gen_random_uuid(),
  session_id          text,
  summary             text,            -- NOT raw chat — just a summary
  red_flag_triggered  boolean default false,
  zip_searched        text,
  clinics_shown       text[],
  created_at          timestamptz default now(),
  ttl_expires_at      timestamptz default (now() + interval '30 days')
);

-- Index for TTL cleanup
create index if not exists idx_conversations_ttl on conversations(ttl_expires_at);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

-- Enable RLS on all tables
alter table clinics enable row level security;
alter table clicks enable row level security;
alter table conversations enable row level security;

-- Clinics: public read, server-only write (via service_role)
create policy "Public can read clinics"
  on clinics for select
  to anon
  using (true);

-- Clicks: anyone can insert (analytics), only service_role can read
create policy "Anyone can insert clicks"
  on clicks for insert
  to anon
  with check (true);

-- Conversations: only service_role can read/write
-- (no anon policy = no public access, which is what we want)

-- ============================================================
-- Auto-purge function for conversations older than 30 days
-- Run via Supabase cron or pg_cron extension
-- ============================================================
create or replace function purge_expired_conversations()
returns void as $$
begin
  delete from conversations where ttl_expires_at < now();
end;
$$ language plpgsql security definer;

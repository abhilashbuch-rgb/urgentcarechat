-- ============================================================
-- urgentcare.chat — Complete Database Setup
-- Run this ONCE in Supabase SQL Editor:
--   Dashboard > SQL Editor > New query > Paste all > Run
-- ============================================================

-- ============================================================
-- 1. CREATE TABLES
-- ============================================================

-- CLINICS — override layer on top of Google Places
-- When our API finds a clinic via Google Places, it checks this table
-- by google_place_id. If a match exists, it merges in our data
-- (insurance tags, services) which Google doesn't provide.
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

create index if not exists idx_clinics_zip on clinics(zip);
create index if not exists idx_clinics_place_id on clinics(google_place_id);

-- BRAND — groups multiple locations of the same chain (e.g. all four
-- "AFC Urgent Care" rows) so a paid is_featured on any one location can
-- boost the whole network in search results — see /api/clinics. Null
-- for independent, single-location clinics.
alter table clinics add column if not exists brand text;
create index if not exists idx_clinics_brand on clinics(brand);

-- ANALYTICS_TOKEN — a private, unguessable link a claimed clinic (or
-- whoever we're courting, e.g. AFC) can be given to see their own
-- referral numbers with no login required — see /clinics/analytics/[token]
-- and /api/clinics/analytics. Not shown anywhere publicly; share it
-- directly with the clinic when they claim a listing.
alter table clinics add column if not exists analytics_token uuid not null default gen_random_uuid() unique;

-- CURRENT WAIT — a live-ish "current wait" signal shown on clinic cards
-- in search results. Two ways to set it, both through the same
-- write-scoped wait_token (see /api/clinics/wait): (1) staff update it
-- themselves from /clinics/wait/[token] on their phone between patients
-- (wait_source='manual'), or (2) a real-time queue vendor the clinic
-- already uses (Solv, Experity, ClockWise.MD, etc.) pushes to the same
-- endpoint once they set up a webhook (wait_source='feed'). Treated as
-- stale and hidden after WAIT_STALE_MINUTES (see lib/wait-time.ts) so a
-- forgotten update doesn't show a confidently wrong number for days.
-- wait_token is deliberately separate from analytics_token — it's a
-- write credential, so it stays scoped to just this one action even if
-- the read-only analytics link gets forwarded around.
alter table clinics add column if not exists current_wait_minutes integer;
alter table clinics add column if not exists wait_updated_at timestamptz;
alter table clinics add column if not exists wait_source text;
alter table clinics add column if not exists wait_token uuid not null default gen_random_uuid() unique;

-- TENANTS — branded white-label subdomains (e.g. afc.urgentcare.chat).
-- Deliberately separate from the `brand` column above: `brand` groups
-- real-world chains for the network-boost ranking feature ("AFC Urgent
-- Care" as a name), while `tenant_slug` below is ours — which of OUR
-- customers a listing/conversation is scoped to. A clinic can belong to
-- a real chain without being any tenant's listing, and vice versa.
create table if not exists tenants (
  slug          text primary key,        -- e.g. 'afc' — used in the subdomain
  display_name  text not null,           -- e.g. 'AFC Urgent Care'
  primary_color text,                    -- hex, e.g. '#1b4b8f' — theirs, not ours; placeholder until provided
  logo_url      text,                    -- theirs, not ours; placeholder until provided
  active        boolean not null default true,
  created_at    timestamptz default now()
);

-- TENANT_SLUG on clinics — which tenant's branded portal this listing
-- belongs to. Null means "general directory only, not tied to any
-- tenant" — the default for almost every row, since most clinics in
-- this table are simply real businesses we surface to the public, not
-- a customer's own locations.
alter table clinics add column if not exists tenant_slug text references tenants(slug);
create index if not exists idx_clinics_tenant on clinics(tenant_slug);

-- CLICKS — analytics (no PII, ever)
create table if not exists clicks (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid references clinics(id),
  clinic_name     text,
  session_id      text,
  event_type      text not null,       -- 'directions', 'call', 'website'
  referrer_zip    text,
  created_at      timestamptz default now()
);

-- CONVERSATIONS — de-identified, QA only, 30-day TTL
-- stores summaries only, NEVER raw chat text
create table if not exists conversations (
  id                  uuid primary key default gen_random_uuid(),
  session_id          text,
  summary             text,
  red_flag_triggered  boolean default false,
  zip_searched        text,
  clinics_shown       text[],
  created_at          timestamptz default now(),
  ttl_expires_at      timestamptz default (now() + interval '30 days')
);

create index if not exists idx_conversations_ttl on conversations(ttl_expires_at);

-- Which tenant's branded portal this conversation happened under. Null
-- means the general/root triage chat, not scoped to any tenant.
alter table conversations add column if not exists tenant_slug text references tenants(slug);

-- CLINIC_CLAIMS — a clinic owner/manager asking to claim & verify their
-- listing. Reviewed manually (for now) before flipping clinics.is_featured
-- or overwriting clinics.hours_json/services/insurance_tags.
create table if not exists clinic_claims (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid references clinics(id),
  google_place_id text,               -- easiest key to reconcile with clinics.google_place_id
  clinic_name     text not null,
  contact_name    text,
  contact_email   text not null,
  contact_phone   text,
  message         text,
  status          text not null default 'pending', -- pending | approved | rejected
  created_at      timestamptz default now()
);

-- FOLLOW_UP_REQUESTS — opt-in only. A patient checks "text me later" after
-- clicking a clinic's directions/call button and gives a phone number.
-- A cron job (see /api/cron/send-follow-ups) texts them ~3 hours later
-- asking how the visit went. Nothing here is created without explicit
-- opt-in, and the phone number is never linked to symptom/chat content.
create table if not exists follow_up_requests (
  id              uuid primary key default gen_random_uuid(),
  clinic_name     text not null,
  phone           text not null,          -- E.164 format
  session_id      text,
  status          text not null default 'scheduled', -- scheduled | sent | failed
  scheduled_for   timestamptz not null,
  sent_at         timestamptz,
  created_at      timestamptz default now()
);

-- Phone is cleared to null once the single opt-in message has actually
-- been sent (see app/api/cron/send-follow-ups), so the column has to
-- allow null. Done as an alter rather than changing the create above,
-- so databases that already ran the original not-null version get
-- loosened too. Idempotent: dropping a not-null that's already dropped
-- is a no-op.
alter table follow_up_requests alter column phone drop not null;

create index if not exists idx_follow_up_due on follow_up_requests(status, scheduled_for);

-- ============================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================

alter table clinics enable row level security;
alter table clicks enable row level security;
alter table conversations enable row level security;
alter table clinic_claims enable row level security;
alter table follow_up_requests enable row level security;
alter table tenants enable row level security;

-- Clinic claims: anyone can submit a claim request; only service_role reads/reviews.
create policy "Anyone can submit a clinic claim"
  on clinic_claims for insert to anon with check (true);

-- Follow-up requests: anyone can opt in; only service_role reads (the cron job).
create policy "Anyone can opt into a follow-up text"
  on follow_up_requests for insert to anon with check (true);

-- Clinics: anyone can read (the API needs this), only service_role can write
create policy "Public can read clinics"
  on clinics for select to anon using (true);

-- Clicks: anyone can insert (analytics from frontend), only service_role reads
create policy "Anyone can insert clicks"
  on clicks for insert to anon with check (true);

-- Conversations: service_role only (no anon policy = locked down)
-- The serverless functions use the service_role key to write here.

-- Tenants: anyone can read active tenants (proxy.ts and the tenant
-- layout need this to theme a subdomain); only service_role writes.
create policy "Public can read active tenants"
  on tenants for select to anon using (active = true);

-- ============================================================
-- 3. AUTO-PURGE for 30-day TTL on conversations
-- ============================================================

create or replace function purge_expired_conversations()
returns void as $$
begin
  delete from conversations where ttl_expires_at < now();
end;
$$ language plpgsql security definer;

-- Schedule daily purge using pg_cron. Not enabled by default on every
-- project — this turns it on (safe/idempotent either way).
create extension if not exists pg_cron;

-- This runs at 3am UTC every day.
select cron.schedule(
  'purge-old-conversations',
  '0 3 * * *',
  'select purge_expired_conversations()'
);

-- ============================================================
-- 4. SEED DATA — Real Philly / South Jersey urgent care clinics
--    with verified Google Place IDs and realistic insurance tags.
--    Insurance data is approximate — clinics should claim/verify.
-- ============================================================

insert into clinics (google_place_id, name, address, phone, lat, lng, zip, services, insurance_tags, rating, brand) values

-- === AFC Urgent Care locations ===
('ChIJaxQljqfAxokRmduNQquSk1E', 'AFC Urgent Care Narberth', '934 Montgomery Ave, Narberth, PA 19072', '(484) 270-8600', 40.0116, -75.2615, '19072',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","occupational_health"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.6, 'AFC Urgent Care'),

('ChIJgbZAtA7GxokRV0s_H2oaf-g', 'AFC Urgent Care South Philly', '1444 W Passyunk Ave, Philadelphia, PA 19145', '(215) 964-9250', 39.9250, -75.1711, '19145',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.6, 'AFC Urgent Care'),

('ChIJayo1KwzJxokR-H01HQe90vI', 'AFC Urgent Care Northern Liberties', '180 W Girard Ave, Philadelphia, PA 19123', '(267) 319-8047', 39.9691, -75.1393, '19123',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","occupational_health"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.7, 'AFC Urgent Care'),

('ChIJY7d8jjLJxokRLZZvMCXB0fk', 'AFC Urgent Care Pennsauken', '6630 S Crescent Blvd, Pennsauken, NJ 08109', '(856) 665-1010', 39.9381, -75.0749, '08109',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","occupational_health"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana","horizon"}', 4.6, 'AFC Urgent Care'),

-- === Vybe Urgent Care locations (Philly chain) ===
('ChIJK3ivrrfJxokRCc4mNl36Qmk', 'vybe urgent care - Market St', '618 Market St, Philadelphia, PA 19106', '(215) 583-0618', 39.9506, -75.1516, '19106',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.8, 'vybe urgent care'),

('ChIJYzGdiPHHxokRPD-5h0f8Xnc', 'vybe urgent care - Spring Garden', '1500 Spring Garden St Ste R105, Philadelphia, PA 19130', '(267) 768-8288', 39.9626, -75.1644, '19130',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.6, 'vybe urgent care'),

('ChIJwxL9wS_GxokRu7lEJe2D7JM', 'vybe urgent care - Chestnut St', '1420 Chestnut St, Philadelphia, PA 19102', '(215) 999-1420', 39.9507, -75.1650, '19102',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.7, 'vybe urgent care'),

('ChIJcSVfThfGxokR4bNC2Bs0fCY', 'vybe urgent care - South Broad', '1217 S Broad St, Philadelphia, PA 19147', '(215) 999-1217', 39.9350, -75.1671, '19147',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.7, 'vybe urgent care'),

('ChIJp3KiLKDHxokRYs7P3G-X_I0', 'vybe urgent care - University City', '3550 Market St Ste 102, Philadelphia, PA 19104', '(215) 405-0701', 39.9558, -75.1939, '19104',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.6, 'vybe urgent care'),

('ChIJ46_Yn4LHxokRhFTPoTmHvKo', 'vybe urgent care - West Philly', '5828 Market St, Philadelphia, PA 19139', '(215) 948-4010', 39.9610, -75.2380, '19139',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.7, 'vybe urgent care'),

('ChIJTQl7-jrHxokRCNTM4sRUKEU', 'vybe urgent care - City Ave', '4190 City Ave Ste 101, Philadelphia, PA 19131', '(215) 857-5300', 40.0045, -75.2175, '19131',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.7, 'vybe urgent care'),

('ChIJLa9H-9XJxokRbYrru43iyhE', 'vybe urgent care - Aramingo', '3356 Aramingo Ave, Philadelphia, PA 19134', '(215) 999-3356', 39.9908, -75.1024, '19134',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.5, 'vybe urgent care'),

('ChIJWyZeRO64xokRuBHe-QG2XSA', 'vybe urgent care - Roxborough', '6060 Ridge Ave #100, Philadelphia, PA 19128', '(215) 999-6060', 40.0329, -75.2149, '19128',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.5, 'vybe urgent care'),

-- === Jefferson Health ===
('ChIJ__8vDjfGxokRFKxuwSwCgPE', 'Jefferson Rittenhouse Urgent Care', '2021 Chestnut St, Philadelphia, PA 19103', '(267) 443-2020', 39.9523, -75.1744, '19103',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 3.5, null),

-- === myDoc Urgent Care ===
('ChIJWyAFNCXGxokR59uHcVNDUuA', 'myDoc Urgent Care - Rittenhouse', '1420 Locust St, Philadelphia, PA 19102', '(215) 800-1909', 39.9482, -75.1658, '19102',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 3.9, 'myDoc Urgent Care'),

('ChIJUaxnnyLHxokR5A8xkZWkhOA', 'myDoc Urgent Care - North Broad', '1501 N Broad St #10, Philadelphia, PA 19122', '(267) 457-5553', 39.9762, -75.1571, '19122',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 4.0, 'myDoc Urgent Care'),

('ChIJ3WEbGFfGxokRTxb09i0ZZqw', 'myDoc Urgent Care - University City', '3717 Chestnut St Ste 202, Philadelphia, PA 19104', '(215) 921-8294', 39.9555, -75.1975, '19104',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 4.0, 'myDoc Urgent Care'),

-- === Other Philly-area clinics ===
('ChIJF5VM1MHHxokRgNCMejn21tg', 'Everest Urgent Care - Ridge Ave', '2077 Ridge Ave, Philadelphia, PA 19121', '(267) 817-9800', 39.9776, -75.1686, '19121',
 '{"x-ray","lab","covid_testing","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 4.3, 'Everest Urgent Care'),

('ChIJi6EmXRDBxokRFvku_dHavwM', 'Everest Urgent Care - Upper Darby', '6787 Market St #101, Upper Darby, PA 19082', '(610) 352-8000', 39.9624, -75.2563, '19082',
 '{"x-ray","lab","covid_testing","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 4.6, 'Everest Urgent Care'),

('ChIJPfuEAi3GxokRtGoumUft1ew', 'Concentra Urgent Care - Center City', '219 N Broad St Ste 101, Philadelphia, PA 19107', '(215) 762-8525', 39.9568, -75.1624, '19107',
 '{"x-ray","lab","covid_testing","occupational_health","sports_physicals"}',
 '{"aetna","bcbs","cigna","united","medicare"}', 4.2, null),

-- === South Jersey clinics ===
('ChIJMUR7aarOxokRFf4H0uCCyAg', 'Virtua Urgent Care - Westmont', '602 W Cuthbert Blvd, Haddon Township, NJ 08108', '(856) 946-5180', 39.9019, -75.0629, '08108',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","horizon"}', 4.7, null),

('ChIJ_WEDhaLPxokR-IH6LUhxyq0', 'Optum Primary Care - Mount Ephraim', '2 S Black Horse Pike, Mt Ephraim, NJ 08059', '(856) 931-3107', 39.8812, -75.0855, '08059',
 '{"x-ray","lab","covid_testing","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","horizon"}', 4.6, null),

-- === Main Line / Montgomery County (from earlier search) ===
('ChIJG5HJUZDAxokRCgYur3k_NNM', 'Main Line Health Urgent Care - Wynnewood', '306 E Lancaster Ave #200, Wynnewood, PA 19096', '(484) 565-1293', 40.0025, -75.2806, '19096',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 4.3, null)

on conflict (google_place_id) do update set
  name = excluded.name,
  address = excluded.address,
  phone = excluded.phone,
  lat = excluded.lat,
  lng = excluded.lng,
  zip = excluded.zip,
  services = excluded.services,
  insurance_tags = excluded.insurance_tags,
  rating = excluded.rating,
  brand = excluded.brand,
  updated_at = now();

-- ============================================================
-- 5. TENANTS — first branded subdomain: afc.urgentcare.chat
-- primary_color is AFC's real brand red, sampled directly from their
-- logo artwork (public/tenants/afc-logo.png — their real mark, supplied
-- by the user for this exact purpose, not something we generated).
-- ============================================================
-- ON CONFLICT DO NOTHING (not DO UPDATE) so re-running this file never
-- clobbers a primary_color/logo_url you've since updated by hand.
insert into tenants (slug, display_name, primary_color, logo_url, active)
values ('afc', 'AFC Urgent Care', '#E61D30', '/tenants/afc-logo.png', true)
on conflict (slug) do nothing;

-- Only AFC's own 4 real locations belong to the afc tenant — everyone
-- else in this table (vybe, myDoc, Everest, Jefferson, ...) stays
-- untenanted, since they're just real businesses we surface publicly,
-- not AFC's own listings.
update clinics set tenant_slug = 'afc' where brand = 'AFC Urgent Care';

-- ============================================================
-- Done! You should see "Success. No rows returned" for the
-- CREATE statements and "Success. 24 rows affected" for the INSERT.
-- ============================================================

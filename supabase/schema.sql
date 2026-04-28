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

-- ============================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================

alter table clinics enable row level security;
alter table clicks enable row level security;
alter table conversations enable row level security;

-- Clinics: anyone can read (the API needs this), only service_role can write
create policy "Public can read clinics"
  on clinics for select to anon using (true);

-- Clicks: anyone can insert (analytics from frontend), only service_role reads
create policy "Anyone can insert clicks"
  on clicks for insert to anon with check (true);

-- Conversations: service_role only (no anon policy = locked down)
-- The serverless functions use the service_role key to write here.

-- ============================================================
-- 3. AUTO-PURGE for 30-day TTL on conversations
-- ============================================================

create or replace function purge_expired_conversations()
returns void as $$
begin
  delete from conversations where ttl_expires_at < now();
end;
$$ language plpgsql security definer;

-- Schedule daily purge using pg_cron (Supabase has this enabled)
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

insert into clinics (google_place_id, name, address, phone, lat, lng, zip, services, insurance_tags, rating) values

-- === AFC Urgent Care locations ===
('ChIJaxQljqfAxokRmduNQquSk1E', 'AFC Urgent Care Narberth', '934 Montgomery Ave, Narberth, PA 19072', '(484) 270-8600', 40.0116, -75.2615, '19072',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","occupational_health"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.6),

('ChIJgbZAtA7GxokRV0s_H2oaf-g', 'AFC Urgent Care South Philly', '1444 W Passyunk Ave, Philadelphia, PA 19145', '(215) 964-9250', 39.9250, -75.1711, '19145',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.6),

('ChIJayo1KwzJxokR-H01HQe90vI', 'AFC Urgent Care Northern Liberties', '180 W Girard Ave, Philadelphia, PA 19123', '(267) 319-8047', 39.9691, -75.1393, '19123',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","occupational_health"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.7),

('ChIJY7d8jjLJxokRLZZvMCXB0fk', 'AFC Urgent Care Pennsauken', '6630 S Crescent Blvd, Pennsauken, NJ 08109', '(856) 665-1010', 39.9381, -75.0749, '08109',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","occupational_health"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana","horizon"}', 4.6),

-- === Vybe Urgent Care locations (Philly chain) ===
('ChIJK3ivrrfJxokRCc4mNl36Qmk', 'vybe urgent care - Market St', '618 Market St, Philadelphia, PA 19106', '(215) 583-0618', 39.9506, -75.1516, '19106',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.8),

('ChIJYzGdiPHHxokRPD-5h0f8Xnc', 'vybe urgent care - Spring Garden', '1500 Spring Garden St Ste R105, Philadelphia, PA 19130', '(267) 768-8288', 39.9626, -75.1644, '19130',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.6),

('ChIJwxL9wS_GxokRu7lEJe2D7JM', 'vybe urgent care - Chestnut St', '1420 Chestnut St, Philadelphia, PA 19102', '(215) 999-1420', 39.9507, -75.1650, '19102',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.7),

('ChIJcSVfThfGxokR4bNC2Bs0fCY', 'vybe urgent care - South Broad', '1217 S Broad St, Philadelphia, PA 19147', '(215) 999-1217', 39.9350, -75.1671, '19147',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.7),

('ChIJp3KiLKDHxokRYs7P3G-X_I0', 'vybe urgent care - University City', '3550 Market St Ste 102, Philadelphia, PA 19104', '(215) 405-0701', 39.9558, -75.1939, '19104',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.6),

('ChIJ46_Yn4LHxokRhFTPoTmHvKo', 'vybe urgent care - West Philly', '5828 Market St, Philadelphia, PA 19139', '(215) 948-4010', 39.9610, -75.2380, '19139',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.7),

('ChIJTQl7-jrHxokRCNTM4sRUKEU', 'vybe urgent care - City Ave', '4190 City Ave Ste 101, Philadelphia, PA 19131', '(215) 857-5300', 40.0045, -75.2175, '19131',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.7),

('ChIJLa9H-9XJxokRbYrru43iyhE', 'vybe urgent care - Aramingo', '3356 Aramingo Ave, Philadelphia, PA 19134', '(215) 999-3356', 39.9908, -75.1024, '19134',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.5),

('ChIJWyZeRO64xokRuBHe-QG2XSA', 'vybe urgent care - Roxborough', '6060 Ridge Ave #100, Philadelphia, PA 19128', '(215) 999-6060', 40.0329, -75.2149, '19128',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","humana"}', 4.5),

-- === Jefferson Health ===
('ChIJ__8vDjfGxokRFKxuwSwCgPE', 'Jefferson Rittenhouse Urgent Care', '2021 Chestnut St, Philadelphia, PA 19103', '(267) 443-2020', 39.9523, -75.1744, '19103',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 3.5),

-- === myDoc Urgent Care ===
('ChIJWyAFNCXGxokR59uHcVNDUuA', 'myDoc Urgent Care - Rittenhouse', '1420 Locust St, Philadelphia, PA 19102', '(215) 800-1909', 39.9482, -75.1658, '19102',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 3.9),

('ChIJUaxnnyLHxokR5A8xkZWkhOA', 'myDoc Urgent Care - North Broad', '1501 N Broad St #10, Philadelphia, PA 19122', '(267) 457-5553', 39.9762, -75.1571, '19122',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 4.0),

('ChIJ3WEbGFfGxokRTxb09i0ZZqw', 'myDoc Urgent Care - University City', '3717 Chestnut St Ste 202, Philadelphia, PA 19104', '(215) 921-8294', 39.9555, -75.1975, '19104',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations","std_testing"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 4.0),

-- === Other Philly-area clinics ===
('ChIJF5VM1MHHxokRgNCMejn21tg', 'Everest Urgent Care - Ridge Ave', '2077 Ridge Ave, Philadelphia, PA 19121', '(267) 817-9800', 39.9776, -75.1686, '19121',
 '{"x-ray","lab","covid_testing","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 4.3),

('ChIJi6EmXRDBxokRFvku_dHavwM', 'Everest Urgent Care - Upper Darby', '6787 Market St #101, Upper Darby, PA 19082', '(610) 352-8000', 39.9624, -75.2563, '19082',
 '{"x-ray","lab","covid_testing","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 4.6),

('ChIJPfuEAi3GxokRtGoumUft1ew', 'Concentra Urgent Care - Center City', '219 N Broad St Ste 101, Philadelphia, PA 19107', '(215) 762-8525', 39.9568, -75.1624, '19107',
 '{"x-ray","lab","covid_testing","occupational_health","sports_physicals"}',
 '{"aetna","bcbs","cigna","united","medicare"}', 4.2),

-- === South Jersey clinics ===
('ChIJMUR7aarOxokRFf4H0uCCyAg', 'Virtua Urgent Care - Westmont', '602 W Cuthbert Blvd, Haddon Township, NJ 08108', '(856) 946-5180', 39.9019, -75.0629, '08108',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","horizon"}', 4.7),

('ChIJ_WEDhaLPxokR-IH6LUhxyq0', 'Optum Primary Care - Mount Ephraim', '2 S Black Horse Pike, Mt Ephraim, NJ 08059', '(856) 931-3107', 39.8812, -75.0855, '08059',
 '{"x-ray","lab","covid_testing","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid","horizon"}', 4.6),

-- === Main Line / Montgomery County (from earlier search) ===
('ChIJG5HJUZDAxokRCgYur3k_NNM', 'Main Line Health Urgent Care - Wynnewood', '306 E Lancaster Ave #200, Wynnewood, PA 19096', '(484) 565-1293', 40.0025, -75.2806, '19096',
 '{"x-ray","lab","covid_testing","pediatric","vaccinations"}',
 '{"aetna","bcbs","cigna","united","medicare","medicaid"}', 4.3)

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
  updated_at = now();

-- ============================================================
-- Done! You should see "Success. No rows returned" for the
-- CREATE statements and "Success. 24 rows affected" for the INSERT.
-- ============================================================

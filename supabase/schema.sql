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

-- PROVIDERS — doctors available for a paid instant telehealth chat.
-- Each row is one doctor: their state license, their HIPAA-compliant
-- video/chat room (e.g. a Doxy.me personal room URL), and the phone
-- number that gets a text when a patient pays and is waiting.
-- Add more rows here to onboard more doctors — no code changes needed.
create table if not exists providers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,             -- e.g. "Dr. Jane Smith, MD"
  license_state   text not null,             -- e.g. "PA" — patient must attest to being in this state
  license_number  text,
  practice_name   text,                      -- e.g. "AFC Urgent Care Narberth"
  doxy_room_url   text not null,             -- HIPAA-compliant video/chat room (BAA required with vendor)
  notify_phone    text not null,             -- E.164 format, e.g. "+12155551234"
  platform_fee_cents integer not null default 10000, -- total charged to the patient ($100); platform's take = this minus provider_payout_cents
  is_active       boolean not null default false, -- stays false until NPI-verified — see /api/admin/providers/verify-npi
  created_at      timestamptz default now()
);

create index if not exists idx_providers_state_active on providers(license_state, is_active);

-- Richer profile fields for the doctor-selection marketplace UI.
-- Added via ALTER so this stays idempotent if the table already exists.
alter table providers add column if not exists credentials text;      -- e.g. "MD"
alter table providers add column if not exists specialty   text;      -- e.g. "Family Medicine"
alter table providers add column if not exists bio          text;     -- one-line blurb shown on the doctor card
alter table providers add column if not exists photo_url    text;     -- optional headshot; falls back to initials avatar
alter table providers add column if not exists lat float8;            -- practice location, for proximity routing once there are multiple providers
alter table providers add column if not exists lng float8;
alter table providers add column if not exists years_experience integer;

-- NPI verification — a provider can't go live (is_active) until their NPI
-- checks out as Active in the real NPPES registry for their license_state.
alter table providers add column if not exists npi text;                    -- 10-digit NPI, required before verification
alter table providers add column if not exists npi_verified_at timestamptz; -- set by /api/admin/providers/verify-npi on success

-- Stripe Connect — where the provider's $30 cut is transferred once a
-- connected call actually completes. See /api/admin/providers/connect-onboard.
alter table providers add column if not exists stripe_account_id text;
alter table providers add column if not exists stripe_onboarded boolean not null default false;
alter table providers add column if not exists provider_payout_cents integer not null default 3000; -- $30 of the $100 total ($70 platform take)

-- Provider portal auth — a provider logs in via Supabase Auth magic
-- link sent to this email; auth_user_id links to that auth.users row
-- on their first successful login (see /provider/auth/callback). Set
-- the email yourself when onboarding a provider (schema template at
-- the bottom of this file); the provider never chooses their own email.
alter table providers add column if not exists email text unique;
alter table providers add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

-- is_active means "NPI-verified, allowed to take patients at all";
-- is_available means "toggled on right now" — the marketplace only
-- shows providers where BOTH are true.
alter table providers add column if not exists is_available boolean not null default false;

alter table providers enable row level security;

-- Providers can read and update only their OWN row, matched via the
-- auth_user_id linked at first login. This is in addition to the
-- service_role-only access already used by admin/webhook routes.
drop policy if exists "Providers can view their own row" on providers;
create policy "Providers can view their own row"
  on providers for select
  using (auth.uid() = auth_user_id);

drop policy if exists "Providers can update their own profile" on providers;
create policy "Providers can update their own profile"
  on providers for update
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

-- RLS controls WHICH ROW a provider can touch, not which COLUMNS —
-- without this, a logged-in provider could set their own is_active,
-- provider_payout_cents, stripe_account_id, etc. directly via the
-- client SDK. Column-level grants close that: the `authenticated`
-- role can only ever update this specific list, no matter what the
-- request contains.
revoke update on providers from authenticated;
grant update (bio, credentials, specialty, years_experience, photo_url, is_available) on providers to authenticated;

-- TELEHEALTH_REQUESTS — one row per paid connection request.
-- Created when a Stripe Checkout Session starts, marked paid once
-- confirmed, and used to make the doctor-notify SMS idempotent.
create table if not exists telehealth_requests (
  id                    uuid primary key default gen_random_uuid(),
  provider_id           uuid references providers(id),
  stripe_session_id     text unique not null,
  patient_state_attested text,
  patient_phone         text,     -- E.164; used only for the masked call bridge, never shown to the provider
  symptom_summary        text,    -- free text from the pre-payment screening step
  status                text not null default 'pending', -- pending | paid | notified
  amount_cents          integer not null,
  created_at            timestamptz default now(),
  paid_at               timestamptz,
  notified_at           timestamptz
);

create index if not exists idx_telehealth_requests_session on telehealth_requests(stripe_session_id);

-- Idempotent for anyone who already ran the table above without these columns.
alter table telehealth_requests add column if not exists patient_phone text;
alter table telehealth_requests add column if not exists patient_email text; -- optional; used only to email the superbill (see lib/superbill.ts)
alter table telehealth_requests add column if not exists symptom_summary text;
alter table telehealth_requests add column if not exists proxy_session_sid text;
alter table telehealth_requests add column if not exists provider_proxy_number text;

-- Provider payout tracking — set by /api/webhooks/twilio-proxy once the
-- masked call actually completes. 'pending' until then; never re-paid
-- once 'paid' (idempotency guard against duplicate webhook deliveries).
alter table telehealth_requests add column if not exists payout_status text not null default 'pending'; -- pending | paid | failed | skipped
alter table telehealth_requests add column if not exists payout_transfer_id text;
alter table telehealth_requests add column if not exists payout_error text;

-- Patient demographics — collected ONLY for EMR/HIE patient matching
-- (Carequality/CommonWell match on name+DOB+address/phone, never SSN;
-- we still don't collect SSN, insurance ID, or address). Nulled out
-- once successfully pushed to Metriport — see visit_note below.
alter table telehealth_requests add column if not exists patient_first_name text;
alter table telehealth_requests add column if not exists patient_last_name text;
alter table telehealth_requests add column if not exists patient_dob date;

-- Provider visit note — submitted post-call via a one-time token link
-- (see /api/telehealth/note), then pushed to the EMR via Metriport and
-- scrubbed from our own database once that push succeeds. If the push
-- fails, the note stays so a retry has something to send.
alter table telehealth_requests add column if not exists note_token text;              -- random, single-use link token
alter table telehealth_requests add column if not exists note_requested_at timestamptz; -- when we texted the provider the note link (idempotency guard)
alter table telehealth_requests add column if not exists visit_note text;
alter table telehealth_requests add column if not exists visit_note_submitted_at timestamptz;
alter table telehealth_requests add column if not exists emr_push_status text not null default 'not_applicable'; -- not_applicable | pending | pushed | emailed | failed
alter table telehealth_requests add column if not exists emr_push_error text;

create unique index if not exists idx_telehealth_requests_note_token on telehealth_requests(note_token);

-- Superbill — an itemized receipt the PATIENT can self-submit to their
-- own insurance for possible out-of-network reimbursement. We never
-- bill insurance ourselves (that's a fee-splitting/kickback problem if
-- tied to a referral fee); this just hands the patient the paperwork
-- to pursue their own reimbursement. Optional: a provider only enters
-- diagnosis_code/procedure_code if they want one generated.
-- superbill_snapshot captures patient name/DOB + provider identity at
-- generation time, since the live patient_first_name/last_name/dob
-- columns above get scrubbed once the EMR push succeeds — this is
-- retained longer, same as any billing receipt a practice would keep.
alter table telehealth_requests add column if not exists diagnosis_code text;   -- ICD-10, provider-entered
alter table telehealth_requests add column if not exists procedure_code text;  -- CPT, provider-entered
alter table telehealth_requests add column if not exists superbill_token text;
alter table telehealth_requests add column if not exists superbill_snapshot jsonb;
alter table telehealth_requests add column if not exists superbill_generated_at timestamptz;

create unique index if not exists idx_telehealth_requests_superbill_token on telehealth_requests(superbill_token);

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

create index if not exists idx_follow_up_due on follow_up_requests(status, scheduled_for);

-- ============================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================

alter table clinics enable row level security;
alter table clicks enable row level security;
alter table conversations enable row level security;
alter table providers enable row level security;
alter table telehealth_requests enable row level security;
alter table clinic_claims enable row level security;
alter table follow_up_requests enable row level security;

-- Clinic claims: anyone can submit a claim request; only service_role reads/reviews.
create policy "Anyone can submit a clinic claim"
  on clinic_claims for insert to anon with check (true);

-- Follow-up requests: anyone can opt in; only service_role reads (the cron job).
create policy "Anyone can opt into a follow-up text"
  on follow_up_requests for insert to anon with check (true);

-- Providers and telehealth_requests: service_role only (no anon policy).
-- All reads/writes go through server routes using the service_role key —
-- room URLs and phone numbers must never reach the browser directly.

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

-- ============================================================
-- 5. TELEHEALTH PROVIDER SETUP (run manually, once per doctor)
-- Fill in the real values below and run in the SQL editor. The row
-- inserts as is_active=false and is_available=false — it won't appear
-- in the marketplace or accept payments until:
--   1. You call POST /api/admin/providers/verify-npi with this row's
--      id (requires ADMIN_SECRET) — checks NPI against NPPES, flips
--      is_active=true on success.
--   2. The provider logs into /provider/login with the email below
--      (Supabase Auth magic link), which links their account on first
--      login, and toggles "available" on their dashboard themselves.
-- Do NOT commit real license numbers, NPIs, phone numbers, or emails
-- to this file.
-- ============================================================
-- insert into providers (name, license_state, license_number, npi, practice_name, doxy_room_url, notify_phone, email)
-- values ('Dr. FULL NAME, MD', 'PA', 'PA LICENSE NUMBER', 'NPI NUMBER', 'AFC Urgent Care Narberth', 'https://doxy.me/YOUR_ROOM_NAME', '+1XXXXXXXXXX', 'doctor@example.com');
-- (platform_fee_cents defaults to 10000 / $100, provider_payout_cents to 3000 / $30 — override either if this doctor's split differs)

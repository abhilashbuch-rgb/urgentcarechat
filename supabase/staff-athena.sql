-- ============================================================
-- ATHENAHEALTH INTEGRATION — connection state and cached OAuth
-- token for the 2-legged (client_credentials) background-sync flow.
--
-- Run AFTER supabase/staff-schema.sql. Idempotent.
--
-- SCOPE OF THIS FILE. This is the foundation for a Marketplace
-- integration that is still in the "we don't have sandbox credentials
-- yet" stage — see lib/athena/auth.ts and lib/athena/client.ts, which
-- this table backs. It holds ONE practice-level connection per org,
-- for the background-sync token (departments/staff/documents). The
-- per-STAFF-MEMBER "Authorization Code (3-legged) for staff SSO" flow
-- described in the original integration roadmap is a separate concern
-- with a different lifetime (one token per person, not per org) and is
-- NOT built here — do not bolt it onto this table when that work
-- starts; give it its own.
--
-- ONE ROW PER ORG. An athenahealth practice and a medicin.io org are
-- assumed to be the same clinic, so this is keyed by org_slug directly
-- rather than getting its own surrogate id.
--
-- THE ACCESS TOKEN IS ENCRYPTED, NOT JUST HASHED. Every other bearer
-- secret in this schema (surveyor links, calendar links, invites) is a
-- token WE mint, so only a hash needs to survive — nobody needs the
-- original back. This is different: it is athenahealth's token, and
-- lib/athena/auth.ts has to present the real value on every API call.
-- That makes this the one place in the schema that needs real
-- decryptable encryption at rest rather than a one-way hash — see
-- lib/athena/auth.ts for the AES-256-GCM implementation and the
-- ATHENA_TOKEN_ENCRYPTION_KEY it reads.
-- ============================================================

create table if not exists staff.athena_connections (
  org_slug     text primary key references staff.orgs(slug) on delete cascade,

  -- athenahealth's practiceid, once connected. Not a foreign key to
  -- anything of ours — it names a record that lives entirely on
  -- athenahealth's side.
  practice_id  text not null,

  environment  text not null default 'preview'
               check (environment in ('preview', 'production')),

  -- AES-256-GCM, base64: iv (12 bytes) || ciphertext || auth tag (16
  -- bytes), concatenated then base64-encoded. Never the raw token.
  access_token_encrypted text,
  access_token_expires_at timestamptz,

  connected_at timestamptz not null default now(),
  connected_by uuid references staff.users(id) on delete set null,

  -- Set by whichever sync job last ran successfully. Nothing populates
  -- this yet — sync-departments/sync-staff don't exist until we have
  -- real credentials to build them against.
  last_synced_at timestamptz
);

alter table staff.athena_connections enable row level security;
alter table staff.athena_connections force row level security;

drop policy if exists staff_org_isolation on staff.athena_connections;
create policy staff_org_isolation on staff.athena_connections
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update, delete on staff.athena_connections to staff_app;

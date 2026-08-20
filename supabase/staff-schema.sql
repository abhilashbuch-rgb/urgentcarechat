-- ============================================================
-- STAFF COMPLIANCE & INTERNAL OPS — schema
--
-- Run AFTER supabase/schema.sql. Idempotent; safe to re-run.
--
-- Everything here lives in a dedicated `staff` schema, deliberately
-- separate from the public-schema patient-triage tables (clinics, clicks,
-- conversations, ...). There are NO foreign keys from staff.* into those
-- tables and none the other way. The patient side is anonymous and stores
-- no PHI; this side has named accounts and internal operational data.
-- Keeping them in different schemas means a query written against one can
-- never silently reach the other, and RLS policies can't be confused
-- between them.
--
-- ORG REGISTRY — read before changing.
-- The public schema already has a `tenants` table (slug, display_name,
-- active) which is what resolves afc.medicin.io to a brand today.
-- staff.orgs deliberately does NOT foreign-key to it, but DOES use the
-- same slug as its primary key. So there is one shared vocabulary for
-- "which org is this" and no cross-schema dependency: a staff org exists
-- only if someone creates it here, and deleting a tenant can't cascade
-- into staff records. The slug is the contract.
-- ============================================================

create schema if not exists staff;

-- ============================================================
-- ORGS & USERS
-- ============================================================

create table if not exists staff.orgs (
  slug        text primary key,          -- matches public.tenants.slug by convention, not by FK
  name        text not null,
  plan        text not null default 'internal',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Roles are a fixed vocabulary, enforced in the database rather than only
-- in application code — a bug in a route handler shouldn't be able to
-- invent a role that RLS doesn't understand.
do $$ begin
  create type staff.user_role as enum (
    'platform_super_admin',   -- global; the only role not scoped to one org
    'org_admin',
    'clinical_lead',
    'staff'
  );
exception when duplicate_object then null;
end $$;

create table if not exists staff.users (
  id          uuid primary key default gen_random_uuid(),
  google_sub  text,                      -- Google's stable subject id; set on first sign-in
  email       text not null,
  name        text,
  org_slug    text references staff.orgs(slug) on delete restrict,
  role        staff.user_role not null default 'staff',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz,
  -- Every role except the platform super admin must belong to an org.
  constraint staff_users_org_required
    check (role = 'platform_super_admin' or org_slug is not null)
);

-- Identity is unique WITHIN an org, not globally. One person can be staff
-- at two franchises with the same Google account, and a global unique on
-- google_sub would make the second org's invite fail with a constraint
-- error that looks like a bug.
alter table staff.users drop constraint if exists staff_users_google_sub_key;

create unique index if not exists staff_users_email_org
  on staff.users (lower(email), coalesce(org_slug, ''));

create unique index if not exists staff_users_google_org
  on staff.users (google_sub, coalesce(org_slug, '')) where google_sub is not null;

-- INVITES — the actual access control.
-- "Sign in with Google" is authentication, not authorization: without this
-- table anyone with a Google account could create a session. A sign-in is
-- only accepted if the email matches an invite row (or its domain matches
-- an org's allow-listed domain), and no match must deny with a clear
-- message rather than silently creating an account.
create table if not exists staff.org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_slug    text not null references staff.orgs(slug) on delete cascade,
  email       text,                      -- exact address, OR
  email_domain text,                     -- everyone at a domain, e.g. 'buchmedical.com'
  role        staff.user_role not null default 'staff',
  invited_by  uuid references staff.users(id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  constraint staff_invite_target
    check ((email is not null) <> (email_domain is not null))
);

create index if not exists staff_invites_lookup
  on staff.org_invites (lower(coalesce(email, email_domain))) where revoked_at is null;

-- ============================================================
-- FORMS
-- ============================================================

create table if not exists staff.form_templates (
  id          uuid primary key default gen_random_uuid(),
  org_slug    text not null references staff.orgs(slug) on delete cascade,
  name        text not null,
  category    text,
  -- The whole point of the form builder: a template is data, not code, so
  -- the 8 seeded logs are ordinary rows rather than special-cased forms.
  schema_json jsonb not null,
  frequency   text not null,             -- 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'per_shift'
  version     integer not null default 1,
  active      boolean not null default true,
  created_by  uuid references staff.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists staff_templates_org on staff.form_templates (org_slug) where active;

create table if not exists staff.form_instances (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references staff.form_templates(id) on delete cascade,
  org_slug     text not null references staff.orgs(slug) on delete cascade,
  due_date     date not null,
  assigned_to  uuid references staff.users(id),
  status       text not null default 'due',   -- due | submitted | approved | flagged
  created_at   timestamptz not null default now(),
  -- One instance per template per due date; makes the scheduled generator
  -- safely re-runnable instead of producing duplicates on a retry.
  unique (template_id, due_date)
);

create index if not exists staff_instances_org_status
  on staff.form_instances (org_slug, status, due_date);

create table if not exists staff.form_responses (
  id           uuid primary key default gen_random_uuid(),
  instance_id  uuid not null references staff.form_instances(id) on delete cascade,
  org_slug     text not null references staff.orgs(slug) on delete cascade,
  submitted_by uuid not null references staff.users(id),
  submitted_at timestamptz not null default now(),
  answers_json jsonb not null,
  status       text not null default 'pending',  -- pending | approved | flagged
  -- Corrections create a NEW response pointing at the one it supersedes.
  -- A compliance log that can be silently edited after the fact is not
  -- evidence of anything.
  supersedes_id uuid references staff.form_responses(id)
);

create index if not exists staff_responses_instance on staff.form_responses (instance_id);

create table if not exists staff.attachments (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null references staff.form_responses(id) on delete cascade,
  org_slug     text not null references staff.orgs(slug) on delete cascade,
  kind         text not null default 'photo',    -- photo | file
  storage_path text not null,
  note         text,
  -- Staff phones can catch a patient or a screen in the background. The
  -- uploader affirms they checked; the affirmation is recorded with the
  -- file rather than living only in a policy document.
  no_pii_confirmed boolean not null default false,
  uploaded_by  uuid not null references staff.users(id),
  created_at   timestamptz not null default now()
);

create table if not exists staff.review_actions (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null references staff.form_responses(id) on delete cascade,
  org_slug     text not null references staff.orgs(slug) on delete cascade,
  reviewer_id  uuid not null references staff.users(id),
  action       text not null,                    -- approved | flagged | commented
  note         text,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- AUDIT
-- ============================================================

create table if not exists staff.audit_log (
  id          bigserial primary key,
  org_slug    text,
  actor_id    uuid references staff.users(id),
  action      text not null,
  entity      text,
  entity_id   text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists staff_audit_org_time on staff.audit_log (org_slug, created_at desc);

-- ============================================================
-- ROW-LEVEL SECURITY
--
-- Isolation is enforced here, not in route handlers. The org a request
-- belongs to is never taken from the client.
--
-- current_setting('staff.org_slug') and ('staff.role') are set per
-- connection by the server after it has resolved the session — see
-- lib/staff/db.ts. A connection that hasn't set them sees nothing, which
-- is the correct failure mode: a forgotten SET yields an empty result,
-- not someone else's data.
-- ============================================================

create or replace function staff.current_org() returns text
language sql stable as $$
  select nullif(current_setting('staff.org_slug', true), '')
$$;

create or replace function staff.is_super_admin() returns boolean
language sql stable as $$
  select coalesce(current_setting('staff.role', true), '') = 'platform_super_admin'
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'orgs','users','org_invites','form_templates','form_instances',
    'form_responses','attachments','review_actions','audit_log'
  ] loop
    execute format('alter table staff.%I enable row level security', t);
    execute format('alter table staff.%I force row level security', t);
  end loop;
end $$;

-- Every org-scoped table gets the same shape of policy: your org, or you
-- are the platform super admin.
do $$
declare t text;
begin
  foreach t in array array[
    'users','org_invites','form_templates','form_instances',
    'form_responses','attachments','review_actions','audit_log'
  ] loop
    execute format('drop policy if exists staff_org_isolation on staff.%I', t);
    execute format($f$
      create policy staff_org_isolation on staff.%I
        for all
        using (staff.is_super_admin() or org_slug = staff.current_org())
        with check (staff.is_super_admin() or org_slug = staff.current_org())
    $f$, t);
  end loop;
end $$;

drop policy if exists staff_orgs_isolation on staff.orgs;
create policy staff_orgs_isolation on staff.orgs
  for all
  using (staff.is_super_admin() or slug = staff.current_org())
  with check (staff.is_super_admin());

-- ============================================================
-- APPLICATION ROLE
--
-- The app connects as this role, NOT as `postgres`. A superuser bypasses
-- row-level security entirely, which would turn every policy above into
-- decoration while still looking correct in code review. This role has no
-- BYPASSRLS and owns nothing, so the policies actually apply to it.
--
-- Set the password yourself and put the resulting connection string in
-- STAFF_DATABASE_URL:
--
--   alter role staff_app with password 'a-long-random-password';
--
--   STAFF_DATABASE_URL=postgresql://staff_app:<password>@<host>:6543/postgres
-- ============================================================

do $$ begin
  create role staff_app with login password null;
exception when duplicate_object then null;
end $$;

grant usage on schema staff to staff_app;
grant select, insert, update, delete on all tables in schema staff to staff_app;
grant usage, select on all sequences in schema staff to staff_app;
alter default privileges in schema staff
  grant select, insert, update, delete on tables to staff_app;
alter default privileges in schema staff
  grant usage, select on sequences to staff_app;

-- ============================================================
-- SEED — the first org.
-- Slug matches public.tenants.slug ('afc') by convention so the staff area
-- and the patient portal agree on what "afc" means.
-- ============================================================

-- Keep `name` matching public.tenants.display_name for the same slug. They
-- are separate columns in separate schemas on purpose, but a staff screen
-- shows the tenant's display name in the header and this one in the body,
-- and two different names for one clinic on one screen reads as a bug.
insert into staff.orgs (slug, name, plan)
values ('afc', 'AFC Urgent Care', 'internal')
on conflict (slug) do nothing;

-- ============================================================
-- Done. Next:
--
--   1. alter role staff_app with password '…'  (see above)
--   2. Set these env vars:
--        STAFF_DATABASE_URL       postgres://staff_app:…  (pooler, port 6543)
--        STAFF_SESSION_SECRET     32+ random characters
--        GOOGLE_OAUTH_CLIENT_ID
--        GOOGLE_OAUTH_CLIENT_SECRET
--   3. In the Google Cloud console, add
--        https://afc.medicin.io/api/staff/auth/callback
--      as an authorized redirect URI (one per staff hostname).
--   4. Add the first invite —
--
--   insert into staff.org_invites (org_slug, email_domain, role)
--   values ('afc', 'buchmedical.com', 'staff');
--
--   insert into staff.org_invites (org_slug, email, role)
--   values ('afc', 'you@example.com', 'org_admin');
--
-- Until an invite exists, every Google sign-in is correctly denied.
-- ============================================================

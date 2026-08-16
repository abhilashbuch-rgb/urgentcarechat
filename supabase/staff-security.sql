-- ============================================================
-- STAFF SECURITY — second factor, domain restriction, revocation
--
-- Run AFTER supabase/staff-schema.sql. Idempotent; safe to re-run.
--
-- Three additions, each closing a hole that the module opened when it
-- stopped being an anonymous patient tool and started holding named
-- employee records:
--
--  1. GOOGLE HOSTED DOMAIN. "Sign in with Google" accepts any Google
--     account on earth. An invite typo, or an invite to a personal
--     address that later changes hands, is currently enough to get in.
--     When an org sets this, the ID token's `hd` claim must match or the
--     sign-in is refused before the invite is even looked at.
--
--  2. TOTP SECOND FACTOR. OAuth cannot tell us whether Google asked for a
--     second factor, and no ID token claim reports it — so 2FA that
--     depends on Google is 2FA we cannot verify or enforce. This one is
--     ours: enrolled here, checked here, required by role.
--
--  3. SESSION REVOCATION. Sessions are signed cookies with no server-side
--     store, which is why they are cheap — and why deactivating someone
--     did nothing to the session already in their pocket. Every session
--     now carries the epoch it was issued at; bumping a user's epoch
--     invalidates every session they hold, everywhere, on their next
--     request.
-- ============================================================

-- ---------- org policy ----------

-- e.g. 'buchmedical.com'. Null means no restriction — any Google account
-- may sign in provided it has an invite, which is the state an org starts
-- in before it has Workspace.
alter table staff.orgs add column if not exists google_hosted_domain text;

-- Which roles must hold a second factor. Defaults to everyone with
-- authority over other people's records; an org can widen it to all staff.
do $$ begin
  alter table staff.orgs add column mfa_required_roles staff.user_role[] not null
    default array['platform_super_admin','org_admin','clinical_lead']::staff.user_role[];
exception when duplicate_column then null;
end $$;

-- ---------- per-user second factor ----------

-- Base32, as the authenticator app expects it. Stored rather than hashed
-- because TOTP verification needs the secret itself — there is no
-- one-way form of it, which is exactly why a leak of this column is a
-- serious event and why it is never sent to the client after enrollment.
alter table staff.users add column if not exists totp_secret text;
alter table staff.users add column if not exists totp_confirmed_at timestamptz;

-- The last time step accepted for this user. A TOTP code stays valid for
-- its whole window, so without this, a code shoulder-surfed or captured
-- in transit can be replayed within the same 30 seconds.
alter table staff.users add column if not exists totp_last_step bigint;

-- ---------- revocation ----------

-- Bumped to invalidate every session this user holds. A session presents
-- the epoch it was minted with; anything older is refused.
alter table staff.users add column if not exists session_epoch integer not null default 0;

-- Deactivating someone must also cut their live session. Doing it in a
-- trigger rather than in the route handler means it holds for every path
-- that ever sets active = false — an admin screen, a script, a psql
-- session at 2am.
create or replace function staff.revoke_on_deactivate()
returns trigger language plpgsql as $$
begin
  if old.active and not new.active then
    new.session_epoch := old.session_epoch + 1;
  end if;
  return new;
end $$;

drop trigger if exists staff_users_revoke_on_deactivate on staff.users;
create trigger staff_users_revoke_on_deactivate
  before update of active on staff.users
  for each row execute function staff.revoke_on_deactivate();

-- ---------- what a session check reads ----------
--
-- One row, by id, on every staff request. It is deliberately a fresh read
-- rather than something cached: the entire value of a kill switch is that
-- it takes effect on the next request, and a 60-second cache would mean a
-- 60-second window in which a just-fired employee still has access.
create or replace view staff.session_checks
with (security_invoker = true) as
select id, org_slug, role, active, session_epoch,
       (totp_confirmed_at is not null) as mfa_enrolled
  from staff.users;

grant select on staff.session_checks to staff_app;

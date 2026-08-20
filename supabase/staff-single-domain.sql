-- ============================================================
-- SINGLE-DOMAIN STAFF SIGN-IN
--
-- Run AFTER supabase/staff-security.sql. Idempotent.
--
-- The staff area used to live at <org>.urgentcare.chat/staff, which meant
-- the hostname told us which org a request belonged to before we had a
-- session. That was a genuinely good property — a stale cookie could not
-- choose an org — but it cost one Google OAuth redirect URI and one
-- manually-added Vercel domain PER CUSTOMER, which makes self-serve
-- signup impossible.
--
-- Now everyone signs in at medicin.io/staff and the org comes from
-- the person's own row, re-read on every request. Tenant subdomains stay
-- for white-label PATIENT portals, where branding is the point.
--
-- THE CHICKEN AND EGG: sign-in has to find which org an email belongs to
-- BEFORE it can set the org context that RLS needs. There is no way to
-- scope that lookup, because "which scope" is the question being asked.
--
-- So it is one SECURITY DEFINER function, deliberately as narrow as it
-- can be:
--   - takes an email, returns at most 2 rows of (org_slug, role)
--   - returns nothing else: no names, no ids, no other columns
--   - the second row exists only so the caller can DETECT ambiguity and
--     refuse, rather than silently picking an org for someone
-- It is the single place in this schema that reads across orgs, and it
-- is the reason it gets this much comment.
-- ============================================================

create or replace function staff.resolve_signin(p_email text, p_google_sub text)
returns table (org_slug text, member_role staff.user_role, existing boolean)
language sql
security definer
-- Pinned so a search_path an attacker controls cannot shadow the tables
-- this function reads. Mandatory for SECURITY DEFINER; easy to forget.
set search_path = pg_catalog, public
as $$
  -- An existing member wins over any invite: someone already onboarded
  -- keeps their org and their current role, and a later invite to a
  -- different org must not silently move them.
  select u.org_slug, u.role, true
    from staff.users u
   where u.active
     and (u.google_sub = p_google_sub or lower(u.email) = lower(p_email))
   limit 2
$$;

create or replace function staff.resolve_invite(p_email text)
returns table (org_slug text, member_role staff.user_role)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select i.org_slug, i.role
    from staff.org_invites i
   where i.revoked_at is null
     and (lower(i.email) = lower(p_email)
          or lower(i.email_domain) = lower(split_part(p_email, '@', 2)))
   -- An invite addressed to this person beats a blanket domain invite.
   order by (i.email is not null) desc
   limit 2
$$;

-- Executable by the app role and nobody else. REVOKE from public first,
-- because SECURITY DEFINER functions are executable by public by default
-- and that default is how these leak.
revoke all on function staff.resolve_signin(text, text) from public;
revoke all on function staff.resolve_invite(text) from public;
grant execute on function staff.resolve_signin(text, text) to staff_app;
grant execute on function staff.resolve_invite(text) to staff_app;

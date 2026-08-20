-- ============================================================
-- 40. SIGNUP IS FOR OWNERS. STAFF ARE INVITED, NEVER SELF-SERVE.
--
-- /start provisions a clinic. Nothing stopped a medical assistant at an
-- already-onboarded clinic typing their clinic's name into it and
-- getting a SECOND workspace: same clinic, same staff, two boards, two
-- sets of logs, and a surveyor eventually shown the emptier one.
--
-- The existing guard only caught the case where the person already held
-- an invite. Somebody with no invite — which is precisely the person who
-- should not be here — sailed through.
--
-- WHY THE EMAIL DOMAIN. A clinic's staff share a mail domain and almost
-- nothing else that is knowable before authentication. Matching on
-- clinic NAME would refuse "Riverside Urgent Care" in two states, which
-- are genuinely different customers.
--
-- FREE MAIL IS EXEMPT, and has to be: two unrelated owners on gmail.com
-- are not the same clinic, and blocking the second would be refusing a
-- customer to prevent a typo.
-- ============================================================

create or replace function staff.domain_taken(p_email text)
returns table (org_slug text, org_name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with d as (
    select lower(split_part(p_email, '@', 2)) as dom
  )
  select o.slug, o.name
    from d
    join staff.org_invites i
      on lower(split_part(i.email, '@', 2)) = d.dom
    join staff.orgs o on o.slug = i.org_slug
   where d.dom <> ''
     and d.dom not in (
       'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com',
       'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
       'icloud.com', 'me.com', 'mac.com', 'aol.com',
       'proton.me', 'protonmail.com', 'pm.me',
       'gmx.com', 'mail.com', 'zoho.com', 'yandex.com'
     )
   limit 1;
$$;

revoke all on function staff.domain_taken(text) from public;
grant execute on function staff.domain_taken(text) to staff_app;

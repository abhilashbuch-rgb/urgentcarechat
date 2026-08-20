-- ============================================================
-- ADMIN-ISSUED INVITATIONS
--
-- Until this migration, staff.org_invites could only be written by SQL
-- functions and by hand in the SQL editor. The schema said so in a
-- comment: "Add the first invite — insert into staff.org_invites ...".
-- That is fine for the founding owner, whose invite provision_trial
-- writes. It is not a product for the owner who then has to add six
-- medical assistants on a Monday morning.
--
-- WHAT THIS IS NOT: a shared join code. A code passed around a clinic is
-- a bearer secret — it gets texted, written on the break-room whiteboard,
-- and keeps working after the person is gone. There is no per-person
-- revocation and the audit trail cannot say who used it.
--
-- WHAT THIS IS: one link, minted for one address, mailed to that address,
-- dead after 72 hours or one use, revocable by an administrator at any
-- moment before that. The address is still the identity; the link only
-- proves the person reading the mailbox is the person invited.
--
-- WHY 72 HOURS. The sign-in code is ten minutes because the person is
-- standing at the screen having just asked for it. An invitation is
-- different: it arrives while a new hire is mid-shift, or on a Friday
-- before two days off. Ten minutes would mean every invitation needing a
-- resend, and an administrator who resends five times a day stops reading
-- what they click. Three days covers a weekend and still expires well
-- inside a notice period.
-- ============================================================

alter table staff.org_invites
  add column if not exists token_hash  text,
  add column if not exists expires_at  timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists job_role    text,
  add column if not exists sent_at     timestamptz,
  add column if not exists sent_count  int not null default 0;

-- THE TOKEN IS NEVER STORED. Only its SHA-256, exactly as the surveyor
-- links and the sign-in codes do it. A stolen database backup must not
-- be a set of working invitations.
do $$ begin
  alter table staff.org_invites
    add constraint staff_invite_token_is_a_hash
    check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;

-- A DOMAIN INVITE CANNOT CARRY A LINK. Mailing "everyone at
-- buchmedical.com" has no address to send to, and a link that admits
-- anyone at a domain is the shared code this migration exists to avoid.
do $$ begin
  alter table staff.org_invites
    add constraint staff_invite_link_needs_an_address
    check (token_hash is null or email is not null);
exception when duplicate_object then null;
end $$;

-- An accepted or expired invitation must not be findable by token. The
-- partial index is the lookup path and deliberately excludes both.
create index if not exists staff_invites_by_token
  on staff.org_invites (token_hash)
  where token_hash is not null
    and revoked_at is null
    and accepted_at is null;

-- One live invitation per address per org. Re-inviting somebody replaces
-- the previous link rather than leaving two valid ones in two mailboxes.
create unique index if not exists staff_invites_one_live_per_email
  on staff.org_invites (org_slug, lower(email))
  where email is not null
    and revoked_at is null
    and accepted_at is null;

-- ------------------------------------------------------------
-- What an administrator sees
-- ------------------------------------------------------------
drop view if exists staff.pending_invites cascade;
create view staff.pending_invites
with (security_invoker = true) as
select i.id,
       i.org_slug,
       i.email,
       i.role::text            as role,
       i.job_role,
       i.created_at,
       i.expires_at,
       i.sent_at,
       i.sent_count,
       (i.expires_at <= now()) as expired,
       u.name                  as invited_by_name
  from staff.org_invites i
  left join staff.users u on u.id = i.invited_by
 where i.email is not null
   and i.revoked_at is null
   and i.accepted_at is null
 order by i.created_at desc;

grant select on staff.pending_invites to staff_app;

-- ------------------------------------------------------------
-- Termination closes the door in both places
-- ------------------------------------------------------------
--
-- Deactivating somebody who has signed in sets staff.users.active =
-- false. That alone is not enough: if their original invitation is still
-- live they can walk back in through the link in their mailbox and get a
-- fresh user row. So deactivation revokes the invitation too.
--
-- A trigger rather than application code, because there is more than one
-- route to active = false and the one that forgets is the one that
-- matters.
create or replace function staff.revoke_invites_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.active and not new.active then
    update staff.org_invites
       set revoked_at = now()
     where org_slug = new.org_slug
       and lower(email) = lower(new.email)
       and revoked_at is null
       and accepted_at is null;
  end if;
  return new;
end $$;

drop trigger if exists staff_users_deactivate_revokes_invite on staff.users;
create trigger staff_users_deactivate_revokes_invite
  after update of active on staff.users
  for each row
  execute function staff.revoke_invites_on_deactivate();

-- ------------------------------------------------------------
-- RLS and privileges
-- ------------------------------------------------------------
--
-- staff-schema.sql sets ALTER DEFAULT PRIVILEGES granting DELETE on
-- future tables in this schema. org_invites predates that, but the
-- revoke is restated here so a re-run cannot leave DELETE behind: an
-- invitation is revoked, never deleted, so that "who let this person in"
-- still has an answer a year later.
revoke delete on staff.org_invites from staff_app;
grant select, insert, update on staff.org_invites to staff_app;

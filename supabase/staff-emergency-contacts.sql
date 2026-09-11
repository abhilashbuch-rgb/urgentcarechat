-- ============================================================
-- EMERGENCY NUMBERS: ON HAND BEFORE YOU NEED THEM
--
-- Run AFTER supabase/staff-org-settings.sql. Idempotent.
--
-- WHAT THIS DOES NOT DO, ON PURPOSE. It does not look up a clinic's
-- police department, nearest ER, or anything else FROM its zip code.
-- There is no verified, current, per-zip directory of that in this
-- codebase, and a wrong number surfaced confidently during a real
-- emergency is worse than an empty field asking the owner to fill it
-- in — a blank line is obviously incomplete; a plausible-looking wrong
-- one is not caught until somebody dials it. So the zip is recorded as
-- the clinic's own fact about itself (a heading, a starting point:
-- "emergency numbers for 07726"), and every phone number here is one
-- somebody at the clinic actually typed in.
--
-- FIXED CATEGORIES, PLUS ONE REPEATABLE SLOT. Police, fire/EMS, the
-- nearest ER, poison control and HR are asked for by name in
-- app/staff/settings/page.tsx — the prompts a clinic would otherwise
-- have to think up itself during the worst possible moment to be
-- thinking of them. 'other' is the only category that may repeat, for
-- whatever else a clinic wants on hand: an on-call medical director, a
-- landlord, an alarm company.
--
-- READABLE BY EVERYONE, WRITABLE BY A MANAGER OR ABOVE. An emergency
-- does not wait for a promotion — see
-- app/api/staff/settings/emergency-contacts/route.ts for where the
-- write gate actually lives; RLS below only holds the org line, same
-- split as staff-board-prefs.sql and staff-log-notes.sql.
-- ============================================================

alter table staff.orgs
  add column if not exists zip text;

do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_zip_shaped
    check (zip is null or zip ~ '^[0-9]{5}(-[0-9]{4})?$');
exception when duplicate_object then null;
end $$;

-- Same shape as staff.update_org_settings, for the same reason: RLS
-- requires a super admin to write staff.orgs directly (see
-- staff-org-settings.sql), so one more owner-settable column needs one
-- more narrowly-scoped function rather than a widened policy that
-- would also let an owner reach the billing columns on the same row.
create or replace function staff.update_org_zip(
  p_org text,
  p_zip text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_zip is not null and p_zip !~ '^[0-9]{5}(-[0-9]{4})?$' then
    raise exception 'zip must be 5 digits, optionally with a +4, not %', p_zip
      using errcode = 'check_violation';
  end if;

  update staff.orgs set zip = p_zip where slug = p_org;

  if not found then
    raise exception 'no such organization: %', p_org
      using errcode = 'no_data_found';
  end if;
end $$;

revoke all on function staff.update_org_zip(text, text) from public;
grant execute on function staff.update_org_zip(text, text) to staff_app;

create table if not exists staff.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  category text not null check (category in (
    'police', 'fire_ems', 'local_er', 'poison_control', 'hr', 'other'
  )),
  label text not null,
  phone text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table staff.emergency_contacts
    add constraint staff_emergency_contacts_shaped
    check (char_length(btrim(label)) between 1 and 80
       and char_length(btrim(phone)) between 3 and 40);
exception when duplicate_object then null;
end $$;

-- One row per FIXED category — the settings form edits each of those
-- in place rather than accumulating duplicates of "Police." 'other' is
-- exempt: it is the repeatable custom slot.
create unique index if not exists staff_emergency_contacts_one_fixed
  on staff.emergency_contacts (org_slug, category)
  where category <> 'other';

create index if not exists staff_emergency_contacts_org
  on staff.emergency_contacts (org_slug, sort_order);

alter table staff.emergency_contacts enable row level security;
alter table staff.emergency_contacts force row level security;
drop policy if exists staff_org_isolation on staff.emergency_contacts;
create policy staff_org_isolation on staff.emergency_contacts
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update, delete on staff.emergency_contacts to staff_app;

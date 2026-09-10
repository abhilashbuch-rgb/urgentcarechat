-- ============================================================
-- "I SAW THIS" — ONE MANAGER'S NOTE ON ONE LOG, NOT A MESSENGER
--
-- Run AFTER supabase/staff-amend.sql. Idempotent.
--
-- WHY THIS IS NOT THE STAFF CHAT lib/staff/roles.ts explicitly turned
-- down. That decision was about staff messaging EACH OTHER — a live,
-- two-way conversation, which is exactly what triggers Pennsylvania's
-- all-party consent wiretap statute (18 Pa. C.S. § 5703) for a system
-- that records it. This is narrower on every axis that statute cares
-- about: one author (a manager or above), one recipient (whoever filed
-- the log), no reply, and it exists only pinned to an already-filed
-- record — never a free-standing conversation two people are having.
-- Closer in shape to staff.alert_queue or staff.audit_log than to a
-- chat feature.
--
-- ONE NOTE PER LOG, ON PURPOSE. Not a thread — the unique index below
-- is what keeps this a single acknowledgment rather than a
-- conversation that grows underneath a log entry. A manager who wants
-- to add more has nothing to append to; see
-- app/api/staff/logs/notes/route.ts.
--
-- ACKNOWLEDGING IS THE POINT, NOT A READ RECEIPT. read_at is set only
-- by the recipient tapping "Got it" — see
-- app/api/staff/logs/notes/ack/route.ts — never by the note simply
-- rendering on a page. The same discipline as everything else this
-- product records: "was this actually seen" needs to be an answer with
-- a timestamp under it, not somebody's memory of whether a badge was
-- on screen.
-- ============================================================

create table if not exists staff.log_notes (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  response_id uuid not null references staff.form_responses(id) on delete cascade,
  author_id uuid references staff.users(id) on delete set null,
  recipient_id uuid not null references staff.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

do $$ begin
  alter table staff.log_notes
    add constraint staff_log_notes_body_shaped
    check (char_length(btrim(body)) between 1 and 300);
exception when duplicate_object then null;
end $$;

create unique index if not exists staff_log_notes_one_per_response
  on staff.log_notes (response_id);

create index if not exists staff_log_notes_recipient
  on staff.log_notes (recipient_id, read_at);

alter table staff.log_notes enable row level security;
alter table staff.log_notes force row level security;
drop policy if exists staff_org_isolation on staff.log_notes;
create policy staff_org_isolation on staff.log_notes
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

-- Same split as staff-board-prefs.sql: RLS holds the org line. "Only a
-- manager or above may author one, only the recipient may acknowledge
-- one" is enforced in app/api/staff/logs/notes/route.ts and
-- app/api/staff/logs/notes/ack/route.ts instead — a second RLS axis
-- here would be new machinery built for exactly one table.
grant select, insert, update on staff.log_notes to staff_app;
revoke delete on staff.log_notes from staff_app;

-- ============================================================
-- WHO ACTUALLY FILED IT, NOT JUST THEIR NAME
--
-- staff.activity_today (staff-amend.sql) exposes filed_by as a display
-- name only, which was enough for a page nobody could act on. Sending
-- a note to a specific person needs their id, so it is added here
-- rather than making the notify form run a second query per row.
-- ============================================================

drop view if exists staff.activity_today cascade;
create view staff.activity_today
with (security_invoker = true) as
select r.id,
       r.org_slug,
       t.name                     as form_name,
       i.slot,
       r.submitted_at,
       u.name                     as filed_by,
       r.submitted_by,
       r.status,
       r.has_out_of_range,
       r.corrective_action,
       r.location_status,
       r.filed_distance_m,
       r.location_note,
       r.supersedes_id is not null as is_amendment,
       r.correction_reason,
       -- Null on the head of every chain; set on a row that something
       -- newer has replaced, which is how the board greys it out.
       (select x.id from staff.form_responses x
         where x.supersedes_id = r.id limit 1) as superseded_by
  from staff.form_responses r
  join staff.form_instances i on i.id = r.instance_id
  join staff.form_templates t on t.id = i.template_id
  left join staff.users u on u.id = r.submitted_by
 where r.submitted_at >= now() - interval '36 hours'
 order by r.submitted_at desc;

grant select on staff.activity_today to staff_app;

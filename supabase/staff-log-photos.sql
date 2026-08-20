-- ============================================================
-- PHOTO PROOF ON A SHIFT LOG
--
-- Run AFTER supabase/staff-logs.sql. Idempotent.
--
-- WHAT A PHOTO IS FOR HERE. A temperature typed into a box is a claim.
-- A photograph of the NIST display showing that temperature, timestamped
-- against the same submission, is evidence. Same for the crash-cart
-- breakaway seal number and a POCT control read window — the three
-- places where a surveyor's next question is "show me".
--
-- THE FILE IS A KEY, NOT BYTES. Postgres is not a file server, and the
-- bucket is private with signed, expiring reads. See lib/staff/storage.ts.
--
-- OPTIONAL, ALWAYS. A log must never be blocked on a camera: the
-- clinic's wifi drops in the back corridor, the phone is out of storage,
-- the tablet has no rear camera. A missing photo is a weaker record; a
-- missing LOG because the photo would not upload is no record at all,
-- and the second failure is worse than the first.
--
-- ZERO PHI IS A UI PROMISE, NOT A SCHEMA GUARANTEE, and it is worth
-- being honest about the difference. Nothing here can inspect the pixels
-- of an image. What the product does instead: asks for the rear camera
-- directly so the common path never opens the photo library, re-encodes
-- in the browser so EXIF and its GPS tag are stripped, and prints the
-- rule next to the control every single time rather than once at
-- onboarding. Automated detection of a face or a chart in frame would
-- mean sending every clinical photograph to a third-party vision API,
-- which is the same trade this product already declined for staff
-- avatars.
-- ============================================================

create table if not exists staff.log_photos (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  response_id uuid not null references staff.form_responses(id) on delete cascade,

  -- Object key in the private compliance-media bucket.
  file_path text not null,
  file_type text not null,
  file_bytes integer not null check (file_bytes > 0),

  -- What the photograph is of, so a reader knows what they are looking
  -- at without opening it.
  caption text,

  taken_by uuid references staff.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists staff_log_photos_response
  on staff.log_photos (response_id);

create index if not exists staff_log_photos_org
  on staff.log_photos (org_slug, created_at desc);

-- A 1600x1200 JPEG at 0.8 lands around 200-400KB. Four megabytes is
-- generous headroom and still refuses a hand-made request posting an
-- original 48MP capture straight at the bucket.
do $$ begin
  alter table staff.log_photos
    add constraint staff_log_photo_size
    check (file_bytes <= 4194304);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table staff.log_photos
    add constraint staff_log_photo_is_image
    check (file_type in ('image/jpeg', 'image/png', 'image/webp'));
exception when duplicate_object then null;
end $$;

alter table staff.log_photos enable row level security;
alter table staff.log_photos force row level security;

drop policy if exists staff_org_isolation on staff.log_photos;
create policy staff_org_isolation on staff.log_photos
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

-- INSERT ONLY. A photograph attached to a signed log is part of that
-- record: replacing it later would let today's version of events stand
-- in for what was actually photographed, which is the property that
-- makes it evidence rather than decoration.
grant select, insert on staff.log_photos to staff_app;
revoke update, delete on staff.log_photos from staff_app;

-- ============================================================
-- PHOTOS WITH THEIR LOG
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break a re-run.
-- ============================================================

drop view if exists staff.log_photo_index cascade;
create view staff.log_photo_index
with (security_invoker = true) as
select
  p.id,
  p.org_slug,
  p.response_id,
  p.file_path,
  p.file_type,
  p.file_bytes,
  p.caption,
  p.created_at,
  t.slug  as form_slug,
  t.name  as form_name,
  i.slot,
  r.submitted_at,
  r.has_out_of_range,
  u.legal_name as taken_by_name
from staff.log_photos p
join staff.form_responses r on r.id = p.response_id
join staff.form_instances i on i.id = r.instance_id
join staff.form_templates t on t.id = i.template_id
left join staff.users u on u.id = p.taken_by;

grant select on staff.log_photo_index to staff_app;

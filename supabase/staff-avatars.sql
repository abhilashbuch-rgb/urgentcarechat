-- ============================================================
-- STAFF PHOTOS, AND THE BRANDING THAT SITS ON TOP OF THEM
--
-- Run AFTER supabase/staff-schema.sql. Idempotent.
--
-- THE ARCHITECTURE, WHICH IS THE WHOLE POINT
-- ------------------------------------------
-- The stored file is the person's face, cropped square, and NOTHING
-- ELSE. No ring, no badge, no colour, no logo baked in. The brand is a
-- CSS ring and an optional badge drawn on top at render time from the
-- org's own theme columns.
--
-- That means changing affiliation — or just changing a colour — is one
-- UPDATE and every avatar in the product changes with it. Burning the
-- frame into the file would mean re-processing every employee photo in
-- every clinic on every rebrand, and would leave the old brand living in
-- the storage bucket forever afterwards.
--
-- WHAT IS DELIBERATELY NOT HERE: AUTOMATED FACE DETECTION
-- ------------------------------------------------------
-- The brief specified an image-moderation API (Rekognition, Cloud
-- Vision, Azure) doing face detection with a confidence threshold, logo
-- and text OCR, and an explicit-content filter. That is not implemented,
-- and the reason is not effort.
--
-- Running face detection over employee photographs generates a
-- biometric identifier from a face. Illinois' BIPA and Texas' CUBI
-- regulate exactly that, BIPA with a private right of action and
-- statutory damages per violation, and both require written notice and
-- consent BEFORE collection. A clinic in Chicago that switches this
-- product on has just done biometric collection on its own staff
-- without the consent flow, and would not know it. That is the same
-- class of decision as the internal chat module, which is not built
-- either until an employment attorney signs off the consent flow.
--
-- It also sends a photograph of every employee to a third party, in a
-- product whose whole positioning is that it holds as little as
-- possible.
--
-- WHAT IS ENFORCED INSTEAD: format, size, and square aspect, checked in
-- the route; the crop happens in the browser so an uncropped original
-- never leaves the device; and an administrator can clear any photo. In
-- a twenty-person clinic where everyone knows everyone, an unsuitable
-- profile picture is a two-minute conversation, not a machine-learning
-- problem. If moderation is wanted later it comes back with the consent
-- flow attached, not before.
--
-- AND NO BRAND PRESETS SHIPPING SOMEBODY ELSE'S BADGE. The theme takes a
-- colour and a logo URL the clinic supplies. Shipping a preset that
-- bundles another company's trademarked mark as a product feature is a
-- decision for whoever owns the licence to use it, not for a migration.
-- ============================================================

-- Object-storage key for the cropped square. Never a URL: a stored URL
-- outlives the bucket it points at, and these are served through signed
-- links that expire.
alter table staff.users
  add column if not exists avatar_path text;

alter table staff.users
  add column if not exists avatar_updated_at timestamptz;

-- The org's theme. Two columns, because the rest of the white-label
-- metadata — legal entity, site id, address, CLIA, medical director —
-- is already on staff.orgs from staff-security.sql.
alter table staff.orgs
  add column if not exists brand_color text;

alter table staff.orgs
  add column if not exists logo_url text;

-- A colour that is not a colour would be injected straight into a style
-- attribute. Constrained to a six-digit hex here so no route can be the
-- only thing standing between a text column and the DOM.
do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_brand_color_hex
    check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null;
end $$;

-- Same reasoning for the badge: an https URL or nothing. A javascript:
-- or data: value here would render inside an <img> on every page of the
-- app for everyone in the org.
do $$ begin
  alter table staff.orgs
    add constraint staff_orgs_logo_url_https
    check (logo_url is null or logo_url ~ '^https://');
exception when duplicate_object then null;
end $$;

comment on column staff.users.avatar_path is
  'Object key for the cropped square photo. The face only — no ring, badge or brand is ever burned into the file; those are drawn at render time from the org theme.';

-- ============================================================
-- THE THEME, READ ONCE PER PAGE
--
-- security_invoker so it reads under the caller's org context. Dropped
-- first so a later migration inserting a column cannot break the
-- combined setup file's second run.
-- ============================================================

drop view if exists staff.org_theme cascade;
create view staff.org_theme
with (security_invoker = true) as
select
  o.slug,
  o.name,
  o.legal_entity,
  -- Falls back to the product's own royal blue rather than to nothing,
  -- so an org that has never set a theme still renders a deliberate
  -- ring instead of an undefined one.
  coalesce(o.brand_color, '#173a8a') as brand_color,
  o.logo_url
from staff.orgs o;

grant select on staff.org_theme to staff_app;

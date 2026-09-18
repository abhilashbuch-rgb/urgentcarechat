-- ============================================================
-- A VENDOR TIP ON THE EQUIPMENT-CALIBRATION LOG, NOT A PUBLISHED RATE
--
-- Run AFTER supabase/staff-statutory-logs.sql, which seeded
-- equipment-calibration's schema_json. Idempotent (jsonb merge, same
-- key every run).
--
-- The tip: EMSAR services equipment nationwide, relevant to any clinic
-- doing UCA accreditation's equipment-maintenance requirement. The
-- rate mentioned came secondhand (one clinic's own vendor
-- relationship, relayed in conversation) — not something this product
-- can verify or guarantee holds for every clinic that calls. See
-- app/page.tsx's own "NO DOLLAR FIGURES" header for why a number like
-- this belongs hedged, in the one place a clinic actually filing this
-- log will read it, rather than stated as fact on a public page other
-- clinics would see and could catch being wrong.
--
-- lib/staff/forms.ts's formSchema.vendorTip (optional, distinct from
-- .standard) is what renders this — see LogForm.tsx and its .st-log-tip
-- style, deliberately unfilled so it never reads as part of the
-- regulation cited just above it.
-- ============================================================

update staff.form_templates
   set schema_json = schema_json || jsonb_build_object(
     'vendorTip',
     'Preventive-maintenance vendor for this equipment: EMSAR ' ||
     '(nationwide biomedical service) — 800-733-6727. If pursuing UCA ' ||
     'accreditation, ask about a preferred-rate contract; a reported ' ||
     'rate is roughly $1,300/year, but confirm current pricing and ' ||
     'terms directly with EMSAR before relying on it.'
   )
 where slug = 'equipment-calibration';

-- ============================================================
-- A CLINIC THAT PAID GETS A CLINIC
--
-- staff.provision_org creates the org and the first administrator's
-- invite and stops. staff.provision_trial, since staff-facility.sql,
-- also calls staff.seed_facility — so somebody who signs up at /start
-- gets a working board and somebody who pays through the Stripe link
-- gets an empty one. Same product, two doors, opposite outcomes, and the
-- worse outcome belongs to the person who paid.
--
-- Confirmed in a live test rather than reasoned about: a test-mode
-- checkout against the real webhook returned
--   {"received": true, "provisioned": "test-clinic-admin"}
-- and that clinic has no templates at all.
--
-- WHY THE FACILITY TYPE IS urgent_care HERE. A Payment Link cannot ask
-- what kind of clinic you are — it collects a name and a card. The
-- honest options were to guess or to leave the board empty, and an
-- urgent-care board an owner prunes beats a blank page with no
-- explanation. /start still asks properly, which is the door to prefer.
-- ============================================================

create or replace function staff.provision_org(
  p_slug text, p_name text, p_customer text, p_subscription text, p_email text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare final_slug text; n int := 1;
begin
  select slug into final_slug from staff.orgs
   where stripe_customer_id = p_customer limit 1;
  if found then return final_slug; end if;

  final_slug := p_slug;
  while exists (select 1 from staff.orgs where slug = final_slug) loop
    n := n + 1;
    final_slug := p_slug || '-' || n;
  end loop;

  insert into staff.orgs (slug, name, plan, stripe_customer_id,
                          stripe_subscription_id, subscription_status,
                          is_read_only, billing_email, facility_type)
  values (final_slug, p_name, 'stripe', p_customer, p_subscription,
          'active', false, p_email, 'urgent_care');

  -- The person who paid is the first administrator. Without this they
  -- would complete checkout and have nothing to sign into.
  insert into staff.org_invites (org_slug, email, role)
  values (final_slug, lower(p_email), 'org_admin');

  -- The line whose absence meant a paying customer opened an empty board.
  perform staff.seed_facility(final_slug);

  return final_slug;
end $$;

revoke all on function staff.provision_org(text, text, text, text, text) from public;
grant execute on function staff.provision_org(text, text, text, text, text) to staff_app;

-- ---------- Repair anything already provisioned this way ----------
-- Orgs created through checkout before this fix have no templates. Seed
-- them now rather than leaving a customer to discover it. seed_facility
-- skips slugs a clinic already has, so this is safe for orgs that were
-- provisioned correctly.
do $$
declare r record;
begin
  for r in
    select o.slug from staff.orgs o
     where o.plan = 'stripe'
       and not o.is_library
       and not exists (
             select 1 from staff.form_templates t where t.org_slug = o.slug
           )
  loop
    update staff.orgs set facility_type = coalesce(facility_type, 'urgent_care')
     where slug = r.slug;
    perform staff.seed_facility(r.slug);
    raise notice 'seeded templates for stripe-provisioned org %', r.slug;
  end loop;
end $$;

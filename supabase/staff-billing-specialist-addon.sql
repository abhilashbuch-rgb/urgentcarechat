-- ============================================================
-- BILLING SPECIALIST — AN ADD-ON, NOT INCLUDED
--
-- Every other job already has a row in staff.plan_seats; without one
-- here, staff.seat_usage's coalesce(ps.extra_seat_cents, 0) would read
-- as FREE, unlimited billing-specialist seats for every customer on
-- every plan — the opposite of what was asked. Explicit row, same
-- uniform $5/seat rate as everything else (see the header of
-- staff-seats.sql for why the price is flat across jobs), zero
-- included: the first billing specialist a clinic hires is already
-- past the allowance.
--
-- INTERNAL STAYS FREE AND UNLIMITED, matching how that plan already
-- treats every other job ("not a customer, not counted").
--
-- AFC-NARBERTH IS THE EXCEPTION, BY NAME, THE SAME WAY THE FOUR-
-- PROVIDER CLINIC THAT NEGOTIATED IS — staff.org_seat_overrides exists
-- specifically so a deal stays visible as a deal rather than quietly
-- changing what "the trial plan" means for everyone on it. This is the
-- owner's own clinic, where the billing specialist this table is named
-- for actually works; included here, an add-on everywhere else.
-- ============================================================

insert into staff.plan_seats (plan, job_role, included, extra_seat_cents) values
  ('standard', 'billing_specialist', 0, 500)
on conflict (plan, job_role) do update
  set included = excluded.included,
      extra_seat_cents = excluded.extra_seat_cents;

insert into staff.plan_seats (plan, job_role, included, extra_seat_cents)
select 'trial', job_role, included, extra_seat_cents
  from staff.plan_seats where plan = 'standard' and job_role = 'billing_specialist'
on conflict (plan, job_role) do update
  set included = excluded.included,
      extra_seat_cents = excluded.extra_seat_cents;

insert into staff.plan_seats (plan, job_role, included, extra_seat_cents)
select 'internal', job_role, 9999, 0
  from staff.plan_seats where plan = 'standard' and job_role = 'billing_specialist'
on conflict (plan, job_role) do update
  set included = excluded.included,
      extra_seat_cents = excluded.extra_seat_cents;

insert into staff.org_seat_overrides (org_slug, job_role, included, note)
values ('afc-narberth', 'billing_specialist', 1,
        'Billing specialist is an add-on everywhere else; included here, our own clinic.')
on conflict (org_slug, job_role) do update
  set included = excluded.included, note = excluded.note;

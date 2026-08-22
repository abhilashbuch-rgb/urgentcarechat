-- ============================================================
-- SEATS, BY JOB, PER CENTRE
--
-- What a subscription actually buys, made countable.
--
-- THE HOLE THIS FILLS. Billing was keyed to one stripe_customer_id on one
-- org row and nothing anywhere counted anything: no seat cap, no site
-- cap, no user total. A group could sign up once, name the org after the
-- parent company, and put three hundred people across ten buildings
-- under a single $149 subscription. Nothing in the product would object,
-- because nothing in the product was looking.
--
-- A PLAN IS A CENTRE, and a centre includes a certain number of each
-- job. That is the right unit because it is the unit the obligations
-- are: one building has one OSHA log, one CLIA certificate, one
-- refrigerator, one set of extinguishers. Two buildings are two of
-- everything however the company is drawn on paper.
--
-- WHY BY JOB AND NOT ONE HEADCOUNT. Five medical assistants and two
-- providers is a normal urgent care; two medical assistants and five
-- providers is not a clinic, it is a different business. A single
-- headcount cannot tell those apart, so the ALLOWANCE is per job.
--
-- THE PRICE IS NOT. Every seat past the allowance is the same five
-- dollars a month whatever the job, and that is a deliberate choice
-- against the obvious one. Pricing a provider seat above a front desk
-- seat is defensible and is also how you get an administrator quietly
-- filing a nurse practitioner as "front desk" to save eleven dollars —
-- which corrupts the job field that scope of practice, the credential
-- matrix and every role-scoped board depend on. The saving is trivial
-- and the damage is not. One price removes the incentive entirely.
--
-- It is also a sentence somebody can hold in their head: everyone past
-- your allowance is five dollars. Nobody needs a table to understand
-- their own invoice.
--
-- NOTHING HERE BLOCKS ANYBODY. See the note above seat_usage.
-- ============================================================

-- ---------- What a plan includes ----------
--
-- A TABLE, NOT CONSTANTS IN CODE. These numbers are a pricing decision,
-- and pricing decisions change on a call with a customer who has four
-- providers. A row can be edited by whoever is having that call; a
-- constant is a deploy.
create table if not exists staff.plan_seats (
  plan      text not null,
  job_role  staff.job_role not null,
  included  integer not null check (included >= 0),
  -- Per seat per month, past the allowance. Cents, because money in a
  -- float is a rounding error waiting to be argued about with a
  -- customer. Flat across jobs today — see the header for why — but
  -- stored per row so a single deal can move without a migration.
  extra_seat_cents integer not null default 500 check (extra_seat_cents >= 0),
  primary key (plan, job_role)
);

-- Idempotent for databases that already ran the first version of this
-- file, which had no price column.
alter table staff.plan_seats
  add column if not exists extra_seat_cents integer not null default 500;

grant select on staff.plan_seats to staff_app;

insert into staff.plan_seats (plan, job_role, included, extra_seat_cents) values
  ('standard', 'center_admin',      3, 500),
  ('standard', 'medical_assistant', 5, 500),
  ('standard', 'provider',          2, 500),
  ('standard', 'xray_tech',         3, 500),
  ('standard', 'front_desk',        2, 500)
on conflict (plan, job_role) do update
  set included = excluded.included,
      extra_seat_cents = excluded.extra_seat_cents;

-- A trial is the standard plan. Somebody evaluating this should hit the
-- same shape they would pay for — a trial with unlimited seats teaches
-- them a number that is about to change.
insert into staff.plan_seats (plan, job_role, included, extra_seat_cents)
select 'trial', job_role, included, extra_seat_cents
  from staff.plan_seats where plan = 'standard'
on conflict (plan, job_role) do update
  set included = excluded.included,
      extra_seat_cents = excluded.extra_seat_cents;

-- The demo clinic and anything internal. Not a customer, not counted.
insert into staff.plan_seats (plan, job_role, included, extra_seat_cents)
select 'internal', job_role, 9999, 0 from staff.plan_seats where plan = 'standard'
on conflict (plan, job_role) do update
  set included = excluded.included,
      extra_seat_cents = excluded.extra_seat_cents;


-- ---------- Per-clinic exceptions ----------
--
-- The four-provider clinic that negotiated, the grandfathered first
-- customer, the group that bought a bundle. Overrides live beside the
-- plan rather than editing it, so the plan stays the thing every other
-- clinic is on and a deal stays visible AS a deal.
create table if not exists staff.org_seat_overrides (
  org_slug  text not null references staff.orgs(slug) on delete cascade,
  job_role  staff.job_role not null,
  included  integer not null check (included >= 0),
  note      text,
  primary key (org_slug, job_role)
);

grant select on staff.org_seat_overrides to staff_app;

alter table staff.org_seat_overrides enable row level security;
drop policy if exists staff_org_isolation on staff.org_seat_overrides;
create policy staff_org_isolation on staff.org_seat_overrides
  for all using (staff.is_super_admin() or org_slug = staff.current_org());


-- ---------- What is actually in use ----------
--
-- NOTHING HERE BLOCKS ANYBODY, DELIBERATELY.
--
-- The obvious design is to refuse the sixth medical assistant. It is
-- also the wrong one. A clinic that hires somebody on Monday needs them
-- filing the refrigerator log on Monday, and a product that says "no,
-- your plan includes five" has made a billing dispute into a gap in a
-- compliance record — the exact gap this software is sold to prevent.
-- The vaccines do not care whose card is on file.
--
-- So the sixth medical assistant works on her first shift, and the
-- administrator sees a line that says there are six. Over-count is a
-- conversation, not an error message, and it is the clinic's to have
-- rather than the software's to enforce at somebody's expense.
--
-- DEACTIVATED PEOPLE DO NOT COUNT. That is what deactivation is for: the
-- person who left in March should not be on the invoice in June. Their
-- filed records stay forever; their seat does not.
--
-- AN OPEN INVITATION DOES COUNT. An administrator who has invited four
-- more medical assistants has already made the decision, and showing the
-- overage only once they accept means finding out on the day the
-- accounts appear. Counted separately so the line can say which is
-- which.
drop view if exists staff.seat_usage cascade;
create view staff.seat_usage
with (security_invoker = true)
as
select
  o.slug                                             as org_slug,
  r.job_role,
  coalesce(ov.included, ps.included, 0)              as included,
  coalesce(ov.included, ps.included, 0) is distinct from ps.included
                                                     as is_override,
  count(u.id) filter (where u.active)                as in_use,
  count(distinct i.id) filter (
    where i.revoked_at is null
      and i.accepted_at is null
      and not exists (
        select 1 from staff.users x
         where x.org_slug = o.slug
           and lower(x.email) = lower(i.email)
           and x.active
      )
  )                                                  as invited_not_yet_in,
  greatest(
    count(u.id) filter (where u.active)
      - coalesce(ov.included, ps.included, 0),
    0
  )                                                  as over_by,
  coalesce(ps.extra_seat_cents, 0)                   as extra_seat_cents,
  -- What this job is adding to the invoice this month. Shown to the
  -- administrator rather than left for them to work out from a rate and
  -- a count — an overage nobody has multiplied out is an overage nobody
  -- argues with until the card is charged.
  greatest(
    count(u.id) filter (where u.active)
      - coalesce(ov.included, ps.included, 0),
    0
  ) * coalesce(ps.extra_seat_cents, 0)               as extra_cents
from staff.orgs o
cross join unnest(enum_range(null::staff.job_role)) as r(job_role)
left join staff.plan_seats ps
       on ps.plan = o.plan and ps.job_role = r.job_role
left join staff.org_seat_overrides ov
       on ov.org_slug = o.slug and ov.job_role = r.job_role
left join staff.users u
       on u.org_slug = o.slug and u.job_role = r.job_role
-- org_invites.job_role is the ENUM, not text. staff-invites.sql carries an
-- "add column if not exists job_role text" that was a no-op — the column
-- already existed as staff.job_role — so the declaration there says text
-- and the database says otherwise. Joined without a cast, which is what
-- the column actually is.
left join staff.org_invites i
       on i.org_slug = o.slug and i.job_role = r.job_role
where not o.is_library
group by o.slug, r.job_role, ov.included, ps.included, ps.extra_seat_cents;

grant select on staff.seat_usage to staff_app;


-- ---------- People with no job yet ----------
--
-- Somebody invited and signed in but never given a job. They consume no
-- seat under any heading and they see almost nothing on their board,
-- which makes them easy to miss. Surfaced separately rather than folded
-- into a bucket they were never put in.
drop view if exists staff.seat_unassigned cascade;
create view staff.seat_unassigned
with (security_invoker = true)
as
select org_slug, count(*) as unassigned
  from staff.users
 where active and job_role is null
 group by org_slug;

grant select on staff.seat_unassigned to staff_app;


-- ---------- The one number an owner asks for ----------
--
-- "What am I paying beyond the plan." Summed here rather than in the
-- page, so the invoice line and the screen cannot drift apart by
-- somebody changing one and not the other.
drop view if exists staff.seat_bill cascade;
create view staff.seat_bill
with (security_invoker = true)
as
select org_slug,
       sum(over_by)::int      as extra_seats,
       sum(extra_cents)::int  as extra_cents
  from staff.seat_usage
 group by org_slug;

grant select on staff.seat_bill to staff_app;

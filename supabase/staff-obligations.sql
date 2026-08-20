-- ============================================================
-- THE OBLIGATIONS REGISTER
--
-- Run AFTER supabase/staff-trial.sql. Idempotent; safe to re-run.
--
-- WHAT THIS IS FOR, AND WHY THE REST OF THE MODULE DIDN'T ALREADY COVER IT
-- ----------------------------------------------------------------------
-- The module has two shapes of record and neither one is a deadline:
--
--   staff.attestations  — this PERSON read this document, once.
--   staff.form_responses — this TASK was done on this SHIFT, over and over.
--
-- Missing was the third: this ORGANIZATION owes this specific thing by
-- this specific date, and someone has to be the one who owes it. A risk
-- analysis due Sept 25, a certificate that expires, a drill nobody has
-- run this year. Those live in an inbox or a manager's head, which is
-- exactly where they are when a surveyor asks for them and nobody can
-- find who was supposed to do it.
--
-- DERIVED STATUS, NOT STORED STATUS. Overdue is not a flag some job sets
-- overnight; it is `due_on < current_date`, evaluated on read. Same
-- reasoning as the trial clock in staff-trial.sql: a nightly job that
-- marks things overdue is a job that can fail silently, and the failure
-- looks exactly like "nothing is overdue".
--
-- NOT GATED BY READ-ONLY, deliberately. Logs stop when a subscription
-- lapses; obligations do not. A register is a deadline calendar with
-- evidence attached, and blocking it would mean a clinic misses a real
-- regulatory deadline because of a failed card — the precise harm the
-- read-only rule exists to avoid. What lapses is the daily workflow.
-- ============================================================

create table if not exists staff.obligations (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,

  -- Stable identifier, so a recurring obligation keeps its identity
  -- across occurrences and the seed can be re-run without duplicating.
  -- Defaulted rather than nullable: a null key would exempt custom
  -- obligations from the uniqueness index below, which is where
  -- double-entry gets caught.
  key text not null default replace(gen_random_uuid()::text, '-', ''),

  title text not null,
  detail text,
  category text,
  -- The rule, where there is one. Printed next to the obligation so
  -- nobody has to take the app's word for why it exists.
  citation text,
  -- Where this deadline came from: a regulation, a franchise bulletin, an
  -- accreditation finding, a manager. A surveyor's first question about
  -- an item on a list is who put it there.
  source text,

  due_on date not null,

  -- Nullable on purpose. "Nobody owns this" is a real and important
  -- state, and the register shows it loudly rather than quietly
  -- defaulting the owner to whoever created the row.
  owner_id uuid references staff.users(id) on delete set null,

  -- null = one-off. Otherwise the next occurrence is created the moment
  -- this one is completed.
  repeat_months integer check (repeat_months is null or repeat_months between 1 and 60),

  completed_at timestamptz,
  completed_by uuid references staff.users(id),
  evidence_note text,

  -- Set only when reopening a completed obligation. The trigger below
  -- requires it and files the completion it displaced into history.
  reopen_reason text,

  -- Displaced completions. An obligation marked done by mistake is
  -- reopened, not erased.
  history jsonb not null default '[]'::jsonb,

  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references staff.users(id)
);

-- Done without saying what was done is not evidence. Same shape as the
-- corrective-action constraint on form_responses, and for the same
-- reason: the button can enforce it, but only the constraint makes it
-- true of every row regardless of how it got there.
do $$ begin
  alter table staff.obligations
    add constraint staff_obligation_needs_evidence
    check (
      completed_at is null
      or (evidence_note is not null and length(btrim(evidence_note)) >= 3)
    );
exception when duplicate_object then null;
end $$;

-- One occurrence of one obligation per due date. Catches the roll-forward
-- firing twice and a person filing the same annual review from two tabs.
create unique index if not exists staff_obligations_occurrence
  on staff.obligations (org_slug, key, due_on);

create index if not exists staff_obligations_open
  on staff.obligations (org_slug, due_on)
  where completed_at is null and active;

create index if not exists staff_obligations_owner
  on staff.obligations (org_slug, owner_id)
  where completed_at is null and active;

-- ============================================================
-- COMPLETIONS ARE SET-ONCE
--
-- A completion is evidence. Editing one in place would let today's
-- version of events overwrite the record of what was actually filed and
-- when, which is the property that makes the register worth showing to
-- anyone. Reopening is allowed — people mark the wrong row — but it costs
-- a reason and the displaced completion stays visible.
-- ============================================================

create or replace function staff.obligations_completion_guard()
returns trigger language plpgsql as $$
begin
  if old.completed_at is not null and new.completed_at is null then
    if new.reopen_reason is null or length(btrim(new.reopen_reason)) < 3 then
      raise exception 'reopen_reason required: reopening a completed obligation has to say why'
        using errcode = 'check_violation';
    end if;
    new.history := old.history || jsonb_build_object(
      'completed_at',  old.completed_at,
      'completed_by',  old.completed_by,
      'evidence_note', old.evidence_note,
      'reopened_at',   now(),
      'reason',        btrim(new.reopen_reason)
    );
    new.completed_by := null;
    new.evidence_note := null;
    return new;
  end if;

  if old.completed_at is not null
     and new.completed_at is not null
     and (new.completed_at <> old.completed_at
          or new.evidence_note is distinct from old.evidence_note) then
    raise exception 'a recorded completion cannot be edited; reopen it and complete it again'
      using errcode = 'check_violation';
  end if;

  -- A fresh completion clears any reason left over from a previous
  -- reopen, so the column always describes the current state.
  if old.completed_at is null and new.completed_at is not null then
    new.reopen_reason := null;
  end if;

  -- The due date of a completed obligation is history: it is the half of
  -- the record that answers "was it done on time". Moving it afterwards
  -- would quietly turn a late completion into a punctual one, and would
  -- disagree with the next occurrence, which was already dated from the
  -- original. Reopen it if the date was genuinely wrong.
  if old.completed_at is not null and new.completed_at is not null
     and new.due_on <> old.due_on then
    raise exception 'the due date of a completed obligation cannot be moved; reopen it first'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists staff_obligations_guard on staff.obligations;
create trigger staff_obligations_guard
  before update on staff.obligations
  for each row execute function staff.obligations_completion_guard();

-- ============================================================
-- RECURRENCE
--
-- The next occurrence is dated from the DUE date, not the completion
-- date. An annual review done three weeks late is still due the same week
-- next year; dating it from completion would walk every recurring
-- deadline later every cycle until an annual obligation quietly became a
-- fourteen-month one.
-- ============================================================

create or replace function staff.obligations_roll_forward()
returns trigger language plpgsql as $$
declare next_due date;
begin
  if new.repeat_months is null or not new.active then return null; end if;

  next_due := (new.due_on + make_interval(months => new.repeat_months))::date;

  -- A badly overdue recurring item would otherwise create its next
  -- occurrence already in the past. Walk forward to the first one that
  -- hasn't happened yet.
  while next_due < current_date loop
    next_due := (next_due + make_interval(months => new.repeat_months))::date;
  end loop;

  insert into staff.obligations
    (org_slug, key, title, detail, category, citation, source,
     due_on, owner_id, repeat_months, created_by)
  values
    (new.org_slug, new.key, new.title, new.detail, new.category,
     new.citation, new.source, next_due, new.owner_id, new.repeat_months,
     new.completed_by)
  on conflict (org_slug, key, due_on) do nothing;

  return null;
end $$;

drop trigger if exists staff_obligations_roll on staff.obligations;
create trigger staff_obligations_roll
  after update on staff.obligations
  for each row
  when (old.completed_at is null and new.completed_at is not null)
  execute function staff.obligations_roll_forward();

-- ============================================================
-- ROW-LEVEL SECURITY
--
-- Same shape as every other org-scoped table. See staff-schema.sql.
-- ============================================================

alter table staff.obligations enable row level security;
alter table staff.obligations force row level security;

drop policy if exists staff_org_isolation on staff.obligations;
create policy staff_org_isolation on staff.obligations
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.obligations to staff_app;
-- An obligation that turns out not to apply is deactivated, not deleted,
-- so the register keeps the fact that somebody decided it didn't apply.
--
-- The REVOKE is the line that makes that true, and it is not redundant
-- with the GRANT above. staff-schema.sql sets ALTER DEFAULT PRIVILEGES
-- granting delete on every future table in this schema, so this table
-- arrived with DELETE already held and granting three verbs took none of
-- it away. Tested: staff_app deleted a seeded obligation outright before
-- this line existed.
revoke delete on staff.obligations from staff_app;

-- ============================================================
-- THE REGISTER
--
-- security_invoker so it reads under the caller's org context rather than
-- the view owner's — without it a view over an RLS-protected table
-- returns every org's rows. See the same note in staff-onboarding.sql.
-- ============================================================

-- Dropped first rather than CREATE OR REPLACE: replace can only APPEND
-- columns to a view, so once a later migration extends this one, the
-- combined setup file's second run fails here with "cannot drop
-- columns from view" while its first run was clean. Drop-first makes
-- every view definition rerunnable regardless of what extends it.
drop view if exists staff.obligation_register cascade;
create view staff.obligation_register
with (security_invoker = true) as
select
  o.id,
  o.org_slug,
  o.key,
  o.title,
  o.detail,
  o.category,
  o.citation,
  o.source,
  o.due_on,
  o.owner_id,
  o.repeat_months,
  o.completed_at,
  o.completed_by,
  o.evidence_note,
  o.history,
  o.created_at,
  (o.due_on - current_date)                      as days_out,
  jsonb_array_length(o.history) > 0              as was_reopened,
  case
    when o.completed_at is not null then 'done'
    when o.due_on < current_date    then 'overdue'
    when o.due_on <= current_date + 30 then 'due_soon'
    else 'scheduled'
  end                                            as status,
  ow.legal_name                                  as owner_name,
  ow.email                                       as owner_email,
  ow.active                                      as owner_active,
  cb.legal_name                                  as completed_by_name,
  cb.email                                       as completed_by_email
from staff.obligations o
left join staff.users ow on ow.id = o.owner_id
left join staff.users cb on cb.id = o.completed_by
where o.active;

grant select on staff.obligation_register to staff_app;

-- One number for the dashboard, so the landing screen doesn't pull the
-- whole register to count two things.
-- Dropped first rather than CREATE OR REPLACE: replace can only APPEND
-- columns to a view, so once a later migration extends this one, the
-- combined setup file's second run fails here with "cannot drop
-- columns from view" while its first run was clean. Drop-first makes
-- every view definition rerunnable regardless of what extends it.
drop view if exists staff.obligation_summary cascade;
create view staff.obligation_summary
with (security_invoker = true) as
select
  org_slug,
  count(*) filter (where status = 'overdue')::int  as overdue,
  count(*) filter (where status = 'due_soon')::int as due_soon,
  count(*) filter (where status <> 'done' and owner_id is null)::int as unowned,
  min(due_on) filter (where status <> 'done')      as next_due_on
from staff.obligation_register
group by org_slug;

grant select on staff.obligation_summary to staff_app;

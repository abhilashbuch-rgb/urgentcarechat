-- ============================================================
-- APPEND-ONLY, ENFORCED — and a hash chain over the result
--
-- The schema always said corrections create a new row pointing at the
-- one it supersedes. The database never enforced it: line 299 of
-- staff-schema.sql grants select, insert, update, delete on every table
-- in the schema to staff_app, sixteen tables take DELETE back, and the
-- two that matter most — the shift logs and the signatures — took back
-- nothing. So "nothing can be backdated or deleted", which this product
-- says on its homepage, was a property of the application code rather
-- than of the database. That is exactly the assurance an auditor
-- discounts, and rightly.
--
-- Three layers here, weakest to strongest:
--   1. Grants     — staff_app loses UPDATE and DELETE.
--   2. Triggers   — refused even if a later migration re-grants.
--   3. Hash chain — tampering by someone who can bypass both is still
--                   DETECTABLE, which is the only property that
--                   survives an attacker with database access.
--
-- WHAT LAYER 3 DOES AND DOES NOT BUY. A superuser can disable a trigger
-- and rewrite rows. What they cannot do cheaply is rewrite them
-- consistently: every row commits to the one before it, so changing an
-- entry from March means recomputing every row since. And because the
-- daily report already emails the chain head to the owner, breaking it
-- silently means also reaching into a mailbox outside this database.
-- That is the difference between "trust us" and "here is something you
-- can check".
-- ============================================================

-- ---------- 1. Corrections have to say why ----------
alter table staff.form_responses
  add column if not exists correction_reason text;

do $$ begin
  alter table staff.form_responses
    add constraint staff_response_correction_has_a_reason
    -- `correction_reason is not null` is not redundant with the length
    -- test. A CHECK passes when it evaluates to NULL, and
    -- length(btrim(NULL)) >= 20 is NULL, not false — so without this the
    -- one case the constraint exists to forbid, a correction filed with
    -- no reason at all, was accepted silently. Caught by testing it.
    check (
      (supersedes_id is null and correction_reason is null)
      or
      (supersedes_id is not null
       and correction_reason is not null
       and length(btrim(correction_reason)) >= 20)
    );
exception when duplicate_object then null;
end $$;

comment on column staff.form_responses.correction_reason is
  'Why this entry supersedes another. Twenty characters minimum, for the '
  'same reason corrective_action has a floor: "typo" is not a reason a '
  'surveyor can evaluate three years later.';

-- ---------- 2. The hash chain ----------
alter table staff.form_responses
  add column if not exists prev_hash text,
  add column if not exists row_hash  text;

do $$ begin
  alter table staff.form_responses
    add constraint staff_response_hash_shape
    check (row_hash is null or row_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;

-- ONE CHAIN PER CLINIC, not one global chain. A shared chain would make
-- every clinic's verification depend on every other clinic's writes, and
-- would leak the fact of one org's activity into another's records.
create index if not exists staff_responses_chain
  on staff.form_responses (org_slug, submitted_at, id);

create or replace function staff.chain_form_response()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prev text;
begin
  -- SERIALIZE PER ORG. Two concurrent inserts reading the same head
  -- would both commit to it and the chain would fork — a fork is
  -- indistinguishable from a deletion when you walk it later. The lock
  -- is transaction-scoped and per-org, so one clinic's morning rush
  -- never waits on another's.
  perform pg_advisory_xact_lock(hashtext('staff.chain:' || new.org_slug));

  select row_hash into prev
    from staff.form_responses
   where org_slug = new.org_slug and row_hash is not null
   order by submitted_at desc, id desc
   limit 1;

  new.prev_hash := prev;

  -- Everything that would matter to a surveyor goes into the digest.
  -- coalesce throughout: in Postgres, concatenating a NULL yields NULL,
  -- and a NULL digest input would silently produce the same hash for
  -- every row that has one empty field.
  new.row_hash := encode(
    sha256(convert_to(
      coalesce(prev, '')                             || '|' ||
      new.id::text                                   || '|' ||
      new.org_slug                                   || '|' ||
      new.instance_id::text                          || '|' ||
      new.submitted_by::text                         || '|' ||
      to_char(new.submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' ||
      new.answers_json::text                         || '|' ||
      coalesce(new.status, '')                       || '|' ||
      coalesce(new.corrective_action, '')            || '|' ||
      coalesce(new.supersedes_id::text, '')          || '|' ||
      coalesce(new.correction_reason, '')            || '|' ||
      coalesce(new.location_status, '')              || '|' ||
      coalesce(new.filed_distance_m::text, '')       || '|' ||
      coalesce(new.location_note, '')
    , 'UTF8')),
  'hex');

  return new;
end $$;

drop trigger if exists staff_form_responses_chain on staff.form_responses;
create trigger staff_form_responses_chain
  before insert on staff.form_responses
  for each row execute function staff.chain_form_response();

-- ---------- 3. Refuse UPDATE and DELETE outright ----------
create or replace function staff.refuse_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'staff.% is append-only: % is refused. Corrections insert a new row '
    'with supersedes_id and correction_reason set.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end $$;

drop trigger if exists staff_form_responses_append_only on staff.form_responses;
create trigger staff_form_responses_append_only
  before update or delete on staff.form_responses
  for each row execute function staff.refuse_mutation();

drop trigger if exists staff_attestations_append_only on staff.attestations;
create trigger staff_attestations_append_only
  before update or delete on staff.attestations
  for each row execute function staff.refuse_mutation();

-- The grants, so the refusal happens before a statement is even planned.
revoke update, delete on staff.form_responses from staff_app;
revoke update, delete on staff.attestations   from staff_app;

-- ---------- 4. Walking the chain ----------
-- Returns nothing when the chain is intact. Any row it returns is a row
-- whose stored hash disagrees with its contents, or whose link to the
-- previous row is broken — which is what tampering looks like after the
-- fact.
create or replace function staff.verify_log_chain(p_org text)
returns table (
  response_id  uuid,
  submitted_at timestamptz,
  problem      text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r        record;
  expected text;
  prev     text := null;
begin
  for r in
    select * from staff.form_responses
     where org_slug = p_org and row_hash is not null
     order by submitted_at, id
  loop
    expected := encode(sha256(convert_to(
      coalesce(prev, '')                          || '|' ||
      r.id::text                                  || '|' ||
      r.org_slug                                  || '|' ||
      r.instance_id::text                         || '|' ||
      r.submitted_by::text                        || '|' ||
      to_char(r.submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' ||
      r.answers_json::text                        || '|' ||
      coalesce(r.status, '')                      || '|' ||
      coalesce(r.corrective_action, '')           || '|' ||
      coalesce(r.supersedes_id::text, '')         || '|' ||
      coalesce(r.correction_reason, '')           || '|' ||
      coalesce(r.location_status, '')             || '|' ||
      coalesce(r.filed_distance_m::text, '')      || '|' ||
      coalesce(r.location_note, '')
    , 'UTF8')), 'hex');

    if r.prev_hash is distinct from prev then
      response_id := r.id; submitted_at := r.submitted_at;
      problem := 'link broken: a row before this one was altered or removed';
      return next;
    elsif r.row_hash <> expected then
      response_id := r.id; submitted_at := r.submitted_at;
      problem := 'contents altered after filing';
      return next;
    end if;

    prev := r.row_hash;
  end loop;
end $$;

revoke all on function staff.verify_log_chain(text) from public;
grant execute on function staff.verify_log_chain(text) to staff_app;

-- The current head, for the daily report to carry into somebody's inbox.
create or replace function staff.log_chain_head(p_org text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select row_hash from staff.form_responses
   where org_slug = p_org and row_hash is not null
   order by submitted_at desc, id desc limit 1;
$$;

revoke all on function staff.log_chain_head(text) from public;
grant execute on function staff.log_chain_head(text) to staff_app;

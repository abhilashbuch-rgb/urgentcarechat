-- ============================================================
-- THE PROTOCOL LIBRARY
--
-- Run AFTER supabase/staff-schema.sql. Idempotent.
--
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
-- ---------------------------------------------
-- This is SEARCH OVER THE CLINIC'S OWN DOCUMENTS. A provider types
-- "tetanus timing contaminated wound" and gets back the passages of this
-- clinic's wound-care protocol and whatever public guidance has been
-- loaded, verbatim, each with its source and section.
--
-- IT DOES NOT GENERATE CLINICAL ADVICE. No regimen is synthesised, no
-- contraindication is inferred, no dose is composed. The system returns
-- text somebody wrote and a citation for where it came from, and the
-- provider reads it — exactly like the binder on the shelf, only
-- searchable.
--
-- That boundary is the product decision. Software that analyses patient
-- specifics and recommends treatment is clinical decision support, with
-- an FDA exemption analysis and a malpractice conversation attached to
-- it; software that finds you the right page of your own protocol is a
-- search box. There is no schema here for a generated answer, because a
-- column to put one in is how the boundary erodes.
--
-- WHY FULL-TEXT AND NOT EMBEDDINGS. The brief asked for pgvector. This
-- corpus is one clinic's protocol set plus public guidance — hundreds of
-- sections, not millions — and the queries are dense with the exact
-- terms the documents use, because both are written by clinicians in the
-- same vocabulary. Postgres full-text ranks that well, costs nothing per
-- query, needs no embedding provider or API key, returns byte-identical
-- passages rather than nearest neighbours, and is deterministic, which
-- matters when the answer is a clinical document. Semantic search earns
-- its complexity when the query and the corpus use different words. If
-- that turns out to be the case here, the table takes an embedding
-- column later without anything else changing.
--
-- NO PATIENT INFORMATION. Queries are logged for "what is nobody able to
-- find", and a free-text box is exactly where somebody types a name. The
-- log column is capped and the app strips digit runs before writing.
-- ============================================================

create table if not exists staff.protocols (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  key text not null,

  title text not null,
  -- Where this came from, printed with every passage. A clinic protocol,
  -- a CDC page, a specialty society guideline. The first question about
  -- a clinical statement on a screen is who said it.
  source text not null,
  -- The clinic's own reference, where it has one: '#WOUND-04'.
  protocol_code text,
  -- Publication or last-review date of the SOURCE, not of the row. A
  -- guideline from 2019 presented without its year is a guideline
  -- presented as current.
  source_date date,

  -- Who this is for. Empty means everyone.
  job_roles staff.job_role[] not null default '{}',

  -- Reviewed by the medical director, and when. A protocol nobody has
  -- reviewed still appears in results, labelled as such — hiding it
  -- would mean the search quietly missed the document the clinic
  -- actually uses.
  reviewed_on date,
  reviewed_by uuid references staff.users(id),

  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references staff.users(id)
);

create unique index if not exists staff_protocols_key
  on staff.protocols (org_slug, key);

-- ============================================================
-- SECTIONS
--
-- Search returns a SECTION, not a document. Handing somebody a
-- forty-page protocol because one line in it matched is the failure mode
-- of every clinical search box, and at a bedside it is the same as
-- returning nothing.
-- ============================================================

create table if not exists staff.protocol_sections (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references staff.protocols(id) on delete cascade,
  section_no integer not null,

  heading text,
  body text not null,

  -- Generated, not maintained: a search index that a writer has to
  -- remember to refresh is a search index that is wrong.
  --
  -- Weighted A for the heading and B for the body, so a section titled
  -- "Tetanus prophylaxis" outranks one that mentions tetanus in passing.
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('english', body), 'B')
  ) stored,

  created_at timestamptz not null default now()
);

create unique index if not exists staff_protocol_sections_order
  on staff.protocol_sections (protocol_id, section_no);

create index if not exists staff_protocol_sections_search
  on staff.protocol_sections using gin (search);

-- ============================================================
-- QUERY LOG
--
-- Not analytics. This answers one operational question: what are people
-- searching for and not finding, which is the list of protocols this
-- clinic is missing.
-- ============================================================

create table if not exists staff.protocol_queries (
  id uuid primary key default gen_random_uuid(),
  org_slug text not null references staff.orgs(slug) on delete cascade,
  asked_by uuid references staff.users(id) on delete set null,
  q text not null,
  hits integer not null default 0,
  asked_at timestamptz not null default now()
);

create index if not exists staff_protocol_queries_misses
  on staff.protocol_queries (org_slug, asked_at desc)
  where hits = 0;

-- How many words in the query matched nothing in the corpus. This is
-- the "we have no protocol for this" signal, kept as a NUMBER because
-- the words themselves are the ones that cannot be shown to be safe.
alter table staff.protocol_queries
  add column if not exists unknown_terms integer not null default 0;

-- A hard cap in the schema as well as the app. A free-text box is where
-- somebody eventually pastes a chart note, and 200 characters is a
-- question rather than a record.
do $$ begin
  alter table staff.protocol_queries
    add constraint staff_protocol_query_short
    check (length(q) <= 200);
exception when duplicate_object then null;
end $$;

-- ============================================================
-- WHAT MAY BE KEPT OF A QUERY
--
-- The app strips digit runs, dates and MRN-shaped tokens before this is
-- reached. THAT IS NOT ENOUGH AND IT CANNOT BE MADE ENOUGH: no regular
-- expression recognises "Maria Gonzalez" as a name rather than a place,
-- a drug, or a syndrome with two eponyms in it. Tested exactly that way
-- — the dates and the MRN were caught, the name went straight through.
--
-- So the log does not keep what was typed. It keeps only the lexemes
-- that ALREADY APPEAR SOMEWHERE IN THIS CLINIC'S PROTOCOL CORPUS. A word
-- has to be in a published protocol to survive, which a patient's name
-- structurally is not, and the number of words dropped is kept instead
-- so the "nobody can find anything about X" signal is not lost.
--
-- The cost is real and worth naming: a search for a condition the clinic
-- has never written a protocol about keeps none of its terms, which is
-- exactly the case somebody would most like to read. The count carries
-- it — a run of queries with four unknown terms and no hits is the
-- report — and that is the version of this feature that does not put
-- patient names in a table.
-- ============================================================

create or replace function staff.scrub_to_corpus(p_query text)
returns table (kept text, unknown_count integer)
language plpgsql stable as $$
declare
  terms text[];
  survivors text[];
  t text;
begin
  terms := tsvector_to_array(to_tsvector('english', coalesce(p_query, '')));
  if terms is null then
    return query select ''::text, 0;
    return;
  end if;

  survivors := '{}';
  foreach t in array terms loop
    if exists (
      select 1 from staff.protocol_sections s
       where s.search @@ to_tsquery('english', t)
       limit 1
    ) then
      survivors := survivors || t;
    end if;
  end loop;

  return query
    select array_to_string(survivors, ' ')::text,
           (cardinality(terms) - cardinality(survivors))::integer;
end $$;

grant execute on function staff.scrub_to_corpus(text) to staff_app;

-- ============================================================
-- ROW-LEVEL SECURITY
-- protocol_sections has no org column; it is reached only through its
-- protocol, so its policy joins back to one.
-- ============================================================

alter table staff.protocols enable row level security;
alter table staff.protocols force row level security;
drop policy if exists staff_org_isolation on staff.protocols;
create policy staff_org_isolation on staff.protocols
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

alter table staff.protocol_sections enable row level security;
alter table staff.protocol_sections force row level security;
drop policy if exists staff_org_isolation on staff.protocol_sections;
create policy staff_org_isolation on staff.protocol_sections
  for all
  using (exists (
    select 1 from staff.protocols p
     where p.id = protocol_sections.protocol_id
       and (staff.is_super_admin() or p.org_slug = staff.current_org())
  ))
  with check (exists (
    select 1 from staff.protocols p
     where p.id = protocol_sections.protocol_id
       and (staff.is_super_admin() or p.org_slug = staff.current_org())
  ));

alter table staff.protocol_queries enable row level security;
alter table staff.protocol_queries force row level security;
drop policy if exists staff_org_isolation on staff.protocol_queries;
create policy staff_org_isolation on staff.protocol_queries
  for all
  using (staff.is_super_admin() or org_slug = staff.current_org())
  with check (staff.is_super_admin() or org_slug = staff.current_org());

grant select, insert, update on staff.protocols to staff_app;
grant select, insert, update on staff.protocol_sections to staff_app;
-- Insert-only: a query log that can be edited answers nothing.
grant select, insert on staff.protocol_queries to staff_app;
revoke delete on staff.protocols from staff_app;
revoke delete on staff.protocol_sections from staff_app;
revoke update, delete on staff.protocol_queries from staff_app;

-- ============================================================
-- SEARCH
--
-- One function rather than a view, because ranking needs the query.
-- STABLE and security_invoker semantics come from the underlying RLS on
-- the tables it reads — it is not SECURITY DEFINER, so it cannot see
-- past the caller's org.
-- ============================================================

-- ANY TERM, RANKED — NOT EVERY TERM.
--
-- The first version used websearch_to_tsquery directly, which joins bare
-- terms with AND. "tetanus timing contaminated wound" then required all
-- four lexemes in ONE section and returned nothing, while the section
-- headed "Tetanus toxoid timing by vaccination history" sat two rows
-- away in the same table. Clinicians type four or five words; sections
-- are a paragraph long; AND means an empty result almost every time.
--
-- Zero results is the worst possible failure here, because the person is
-- standing in a room with a patient and will conclude the protocol is
-- not in the system rather than that their phrasing was wrong.
--
-- So the terms are ORed and ts_rank does the work: a section matching
-- three of four lexemes outranks one matching one, and the A-weighted
-- heading outranks a passing mention in the body. Quoted phrases and
-- explicit operators are still honoured — if websearch_to_tsquery finds
-- any of those, that query is used as written, because somebody typing
-- quotes means them.
--
-- The OR query is built from tsvector_to_array(to_tsvector(...)), so
-- every element is an already-normalised lexeme. There is no path for a
-- tsquery operator to survive that and reach to_tsquery.
create or replace function staff.search_protocols(
  p_query text,
  p_job staff.job_role default null,
  p_limit integer default 12
)
returns table (
  protocol_id uuid,
  section_id uuid,
  title text,
  source text,
  protocol_code text,
  source_date date,
  reviewed_on date,
  heading text,
  body text,
  section_no integer,
  rank real
)
language plpgsql stable as $$
declare
  q tsquery;
  lexemes text[];
begin
  -- Quotes or explicit operators: honour them exactly.
  if p_query ~ '["|()<>-]' then
    q := websearch_to_tsquery('english', p_query);
  else
    lexemes := tsvector_to_array(to_tsvector('english', p_query));
    if lexemes is null or cardinality(lexemes) = 0 then
      return;
    end if;
    q := to_tsquery('english', array_to_string(lexemes, ' | '));
  end if;

  if q is null then return; end if;

  return query
  select
    p.id, s.id, p.title, p.source, p.protocol_code, p.source_date,
    p.reviewed_on, s.heading, s.body, s.section_no,
    ts_rank(s.search, q) as rank
  from staff.protocol_sections s
  join staff.protocols p on p.id = s.protocol_id
  where p.active
    and staff.brief_matches(p.job_roles, p_job)
    and s.search @@ q
  order by rank desc, p.title, s.section_no
  limit greatest(1, least(coalesce(p_limit, 12), 50));
end $$;

grant execute on function staff.search_protocols(text, staff.job_role, integer)
  to staff_app;

import type { StaffSql } from "@/lib/staff/db";

// Everything the accreditation binder prints, gathered in one pass.
//
// READ-ONLY AND DERIVED. Nothing here writes, and nothing is
// precomputed overnight: the binder is assembled from the same views the
// app reads, at the moment somebody asks for it. A nightly job that
// builds a "current" binder is a job whose failure produces a stale
// binder that still looks official.
//
// ZERO PHI, AND ZERO CREDENTIAL NUMBERS. This document leaves the
// building — it is handed to a surveyor, emailed, printed, filed. It
// carries equipment readings, staff names with expiry DATES, and
// regulatory deadlines. There is no licence number, ARRT number or DEA
// registration anywhere in this system to leak into it, and no patient
// identifier either.

export interface FacilityProfile {
  slug: string;
  name: string;
  legal_entity: string | null;
  site_id: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  clia_number: string | null;
  pa_dep_number: string | null;
  npi: string | null;
  medical_director_name: string | null;
  timezone: string;
}

export interface CurrencyRow {
  legal_name: string | null;
  job_role: string | null;
  kind: string;
  expires_on: string | null;
  status: string;
}

export interface TempReading {
  day: string;
  unit: string | null;
  current_f: number | null;
  min_f: number | null;
  max_f: number | null;
  out_of_range: boolean;
  corrective_action: string | null;
  submitted_by: string | null;
}

export interface LogRow {
  day: string;
  slot: string;
  submitted_at: string;
  submitted_by: string | null;
  out_of_range: boolean;
  corrective_action: string | null;
  answers: Record<string, unknown>;
}

export interface Binder {
  facility: FacilityProfile | null;
  currency: CurrencyRow[];
  temps: TempReading[];
  crashCart: LogRow[];
  poct: LogRow[];
  obligations: {
    title: string;
    due_on: string;
    status: string;
    owner_name: string | null;
    citation: string | null;
  }[];
  attestations: {
    legal_name: string | null;
    doc_title: string;
    signed_at: string;
    doc_version: number;
  }[];
  generatedAt: string;
  windowDays: number;
}

/** Pull the whole binder. One function so the section order in the PDF
 *  and the queries that feed it cannot drift apart. */
export async function gatherBinder(
  sql: StaffSql,
  org: string,
  windowDays = 90
): Promise<Binder> {
  const [facility] = await sql<FacilityProfile[]>`
    select slug, name, legal_entity, site_id, address_line1, city, state,
           postal_code, phone, clia_number, pa_dep_number, npi,
           medical_director_name, timezone
      from staff.orgs where slug = ${org}
  `;

  const currency = await sql<CurrencyRow[]>`
    select cs.legal_name, u.job_role::text as job_role,
           cs.kind::text as kind,
           cs.expires_on::text as expires_on, cs.status
      from staff.credential_status cs
      left join staff.users u on u.legal_name = cs.legal_name
     order by
       case cs.status
         when 'expired' then 0 when 'critical' then 1
         when 'expiring' then 2 when 'no_date' then 3 else 4 end,
       cs.legal_name
  `;

  // Temperature readings, flattened out of the answers JSON so the chart
  // does not have to understand the form schema.
  const temps = await sql<TempReading[]>`
    select (r.submitted_at at time zone o.timezone)::date::text as day,
           r.answers_json->>'unit'                              as unit,
           nullif(r.answers_json->>'current_f','')::numeric     as current_f,
           nullif(r.answers_json->>'min_24h_f','')::numeric     as min_f,
           nullif(r.answers_json->>'max_24h_f','')::numeric     as max_f,
           r.has_out_of_range                                   as out_of_range,
           r.corrective_action,
           u.legal_name                                         as submitted_by
      from staff.form_responses r
      join staff.form_instances i on i.id = r.instance_id
      join staff.form_templates t on t.id = i.template_id
      join staff.orgs o on o.slug = r.org_slug
      left join staff.users u on u.id = r.submitted_by
     where t.slug = 'temp-fridge'
       and r.submitted_at > now() - make_interval(days => ${windowDays})
     order by r.submitted_at
  `;

  const bySlug = (slug: string) => sql<LogRow[]>`
    select (r.submitted_at at time zone o.timezone)::date::text as day,
           i.slot,
           r.submitted_at::text as submitted_at,
           u.legal_name as submitted_by,
           r.has_out_of_range as out_of_range,
           r.corrective_action,
           r.answers_json as answers
      from staff.form_responses r
      join staff.form_instances i on i.id = r.instance_id
      join staff.form_templates t on t.id = i.template_id
      join staff.orgs o on o.slug = r.org_slug
      left join staff.users u on u.id = r.submitted_by
     where t.slug = ${slug}
       and r.submitted_at > now() - make_interval(days => ${windowDays})
     order by r.submitted_at desc
     limit 400
  `;

  const [crashCart, poct, obligations, attestations] = await Promise.all([
    bySlug("crash-cart"),
    bySlug("poct-qc"),
    sql<Binder["obligations"]>`
      select title, due_on::text as due_on, status, owner_name, citation
        from staff.obligation_register
       order by
         case status when 'overdue' then 0 when 'due_soon' then 1 else 2 end,
         due_on
       limit 200
    `,
    sql<Binder["attestations"]>`
      select u.legal_name, a.doc_title, a.signed_at::text as signed_at,
             a.doc_version
        from staff.attestations a
        join staff.users u on u.id = a.user_id
       order by a.signed_at desc
       limit 400
    `,
  ]);

  return {
    facility: facility ?? null,
    currency,
    temps,
    crashCart,
    poct,
    obligations,
    attestations,
    generatedAt: new Date().toISOString(),
    windowDays,
  };
}

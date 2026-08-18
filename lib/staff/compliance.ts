import type { StaffSql } from "@/lib/staff/db";
import type { StaffRole } from "@/lib/staff/session";

// Queries behind the onboarding flow and the compliance record.
//
// Every one of these takes an `sql` handle from withSession/withOrg, so
// they run inside an org-scoped transaction. None of them filters by
// org_slug themselves — that is RLS's job, and duplicating it here would
// create a second place for the two to disagree.

export interface OutstandingDoc {
  doc_id: string;
  doc_key: string;
  version: number;
  title: string;
  category: string | null;
  citation: string | null;
  summary: string | null;
  reason: "never" | "expired";
  previously_signed_at: string | null;
}

export interface PolicyDoc extends OutstandingDoc {
  body_md: string;
  attestation: string;
  renew_months: number | null;
}

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  legal_name: string | null;
  job_title: string | null;
  start_date: string | null;
  esign_consented_at: string | null;
  role: StaffRole;
  /** The clinic job. Null until an administrator assigns one — and
   *  with strict separation that means an almost-empty board, so the
   *  UI has to say so rather than look broken. */
  job_role: string | null;
  /** Object key for the profile photo, or null. Never rendered
   *  directly: the file is served through a signed-link route, because
   *  the same bucket holds licences. */
  avatar_path: string | null;
}

export interface SignedRecord {
  id: string;
  doc_key: string;
  doc_version: number;
  doc_title: string;
  statement: string;
  typed_name: string;
  signed_at: string;
  body_sha256: string;
  signature_path: string | null;
  /** True when the stored document text still hashes to what was signed.
   *  A false here is not a formatting nit — it means the record and the
   *  document have diverged and the record is the one to trust. */
  text_matches: boolean;
}

export async function getProfile(
  sql: StaffSql,
  userId: string
): Promise<Profile | null> {
  const rows = await sql<Profile[]>`
    select id, email, name, legal_name, job_title,
           start_date::text as start_date,
           esign_consented_at::text as esign_consented_at, role,
           job_role::text as job_role, avatar_path
      from staff.users where id = ${userId}
  `;
  return rows[0] ?? null;
}

/** Ordered the way the packet should be read: the master acknowledgement
 *  sorts last because signing it means having read the rest. */
export async function outstandingFor(
  sql: StaffSql,
  userId: string
): Promise<OutstandingDoc[]> {
  return sql<OutstandingDoc[]>`
    select doc_id, doc_key, version, title, category, citation, summary,
           reason, previously_signed_at::text as previously_signed_at
      from staff.outstanding_docs
     where user_id = ${userId}
     order by sort_order, title
  `;
}

export async function loadDoc(
  sql: StaffSql,
  docId: string
): Promise<PolicyDoc | null> {
  const rows = await sql<PolicyDoc[]>`
    select id as doc_id, key as doc_key, version, title, category, citation,
           summary, body_md, attestation, renew_months,
           'never'::text as reason, null::text as previously_signed_at
      from staff.policy_docs
     where id = ${docId} and active and published_at is not null
  `;
  return rows[0] ?? null;
}

export async function signedBy(
  sql: StaffSql,
  userId: string
): Promise<SignedRecord[]> {
  return sql<SignedRecord[]>`
    select a.id, a.doc_key, a.doc_version, a.doc_title, a.statement,
           a.typed_name, a.signed_at::text as signed_at, a.body_sha256,
           a.signature_path,
           -- Recomputed on every read rather than trusted. The point of
           -- storing the hash is to be able to check it.
           --
           -- sha256() is built into Postgres 11+; digest() would have
           -- meant depending on pgcrypto being installed and on which
           -- schema Supabase put it in.
           (encode(sha256(d.body_md::bytea), 'hex') = a.body_sha256)
             as text_matches
      from staff.attestations a
      left join staff.policy_docs d on d.id = a.doc_id
     where a.user_id = ${userId}
     order by a.signed_at desc
  `;
}

export interface TeamMember {
  user_id: string;
  email: string;
  name: string | null;
  legal_name: string | null;
  job_title: string | null;
  role: StaffRole;
  start_date: string | null;
  esign_consented_at: string | null;
  assigned_count: number;
  outstanding_count: number;
  last_signed_at: string | null;
  active: boolean;
  mfa_enrolled: boolean;
  mfa_required: boolean;
}

/** The roster, including deactivated people.
 *
 *  compliance_status only covers active users — correct for a completion
 *  report, wrong for an admin screen, where the whole point is to see
 *  someone you switched off and be able to switch them back on. So this
 *  reads staff.users directly and joins the counts on. */
export async function teamStatus(sql: StaffSql): Promise<TeamMember[]> {
  return sql<TeamMember[]>`
    select u.id as user_id, u.email, u.name, u.legal_name, u.job_title, u.role,
           u.start_date::text as start_date,
           u.esign_consented_at::text as esign_consented_at,
           u.active,
           (u.totp_confirmed_at is not null) as mfa_enrolled,
           (u.role = any (o.mfa_required_roles)) as mfa_required,
           coalesce(c.assigned_count, 0)::int as assigned_count,
           coalesce(c.outstanding_count, 0)::int as outstanding_count,
           c.last_signed_at::text as last_signed_at
      from staff.users u
      join staff.orgs o on o.slug = u.org_slug
      left join staff.compliance_status c on c.user_id = u.id
     order by u.active desc, coalesce(c.outstanding_count, 0) desc, u.email
  `;
}

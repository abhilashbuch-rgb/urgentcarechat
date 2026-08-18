import type { StaffSql } from "@/lib/staff/db";

// The roster's risk surface: what is expiring, and who has not been
// screened. Both are derived on read by the database — nothing here
// decides whether a credential is expired, for the same reason nothing
// decides whether an obligation is overdue.

export type CredStatus = "expired" | "critical" | "expiring" | "current" | "no_date";
export type ScreenStatus = "never" | "overdue" | "flagged" | "current";

export interface Credential {
  credential_id: string;
  user_id: string;
  email: string;
  legal_name: string | null;
  job_role: string | null;
  kind: string;
  issuer: string | null;
  label: string | null;
  expires_on: string | null;
  verified_on: string | null;
  days_left: number | null;
  status: CredStatus;
}

export interface Screen {
  user_id: string;
  email: string;
  legal_name: string | null;
  source: "oig_leie" | "sam_gov";
  checked_on: string | null;
  result: string | null;
  days_since: number | null;
  status: ScreenStatus;
}

export interface RosterRisk {
  expired: number;
  expiring_30: number;
  screens_due: number;
  screens_flagged: number;
}

export const KIND_LABELS: Record<string, string> = {
  state_license: "State licence",
  dea_registration: "DEA registration",
  board_certification: "Board certification",
  bls_cpr: "BLS / CPR",
  acls: "ACLS",
  pals: "PALS",
  arrt: "ARRT",
  malpractice: "Malpractice cover",
  collaborative_agreement: "Collaborative agreement",
  other: "Other",
};

export const SOURCE_LABELS: Record<string, string> = {
  oig_leie: "OIG exclusion list",
  sam_gov: "SAM.gov debarment",
};

export async function credentials(sql: StaffSql): Promise<Credential[]> {
  return sql<Credential[]>`
    select credential_id, user_id, email, legal_name, job_role::text as job_role,
           kind::text as kind, issuer, label,
           expires_on::text as expires_on, verified_on::text as verified_on,
           days_left, status
      from staff.credential_status
     order by
       case status when 'expired' then 0 when 'critical' then 1
                   when 'expiring' then 2 when 'no_date' then 3 else 4 end,
       days_left nulls last, legal_name
  `;
}

export async function screens(sql: StaffSql): Promise<Screen[]> {
  return sql<Screen[]>`
    select user_id, email, legal_name, source::text as source,
           checked_on::text as checked_on, result::text as result,
           days_since, status
      from staff.exclusion_status
     order by
       case status when 'flagged' then 0 when 'never' then 1
                   when 'overdue' then 2 else 3 end,
       legal_name, source
  `;
}

export async function rosterRisk(sql: StaffSql, org: string): Promise<RosterRisk> {
  const rows = await sql<RosterRisk[]>`
    select expired, expiring_30, screens_due, screens_flagged
      from staff.roster_risk where org_slug = ${org}
  `;
  return rows[0] ?? { expired: 0, expiring_30: 0, screens_due: 0, screens_flagged: 0 };
}

/** Plain English for a countdown. Never "in -10 days". */
export function expiryLabel(days: number | null, status: CredStatus): string {
  if (status === "no_date" || days === null) return "No expiry recorded";
  if (days < -1) return `Expired ${Math.abs(days)} days ago`;
  if (days === -1) return "Expired yesterday";
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  if (days <= 90) return `${days} days left`;
  const months = Math.round(days / 30);
  return months === 1 ? "About a month left" : `About ${months} months left`;
}

export function screenLabel(s: Screen): string {
  if (s.status === "never") return "Never screened";
  if (s.status === "flagged") return `Flagged — ${s.result}`;
  if (s.days_since === null) return "Unknown";
  if (s.days_since === 0) return "Screened today";
  if (s.days_since === 1) return "Screened yesterday";
  return `Screened ${s.days_since} days ago`;
}

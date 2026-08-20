import type { StaffSql } from "@/lib/staff/db";

// What is left before somebody can work.
//
// THE SERVER DECIDES WHICH STEP YOU ARE ON. There is no wizard state in
// the browser and no step number in the URL — each request recomputes
// what is outstanding and renders the first of it. The back button, a
// refresh, a second tab and a phone that slept mid-signature all behave
// correctly without any of them being handled specially, and a step
// cannot be skipped by editing a URL because there is no URL to edit.
//
// That was already true of the document loop. This extends the same
// machine over the three steps that were missing: confirming the job,
// entering credential expiry dates, and the orientation.

export interface OnboardingState {
  needs_profile: boolean;
  needs_job: boolean;
  /** True when no job was ever assigned — an administrator's problem,
   *  and a different screen from "you have not confirmed it yet". */
  job_unassigned: boolean;
  /** Credential kinds this person's job requires that have no date yet. */
  missing_credentials: string[];
  outstanding_docs: number;
  needs_orientation: boolean;
  job_role: string | null;
}

export interface CredentialRequirement {
  kind: string;
  required: boolean;
  label: string;
  hint: string | null;
  /** The date already on file, if this is a second pass. */
  expires_on: string | null;
}

/** The five gates, in order. */
export type Step =
  | "profile"
  | "job"
  | "credentials"
  | "documents"
  | "orientation"
  | "done";

export async function onboardingState(
  sql: StaffSql,
  userId: string
): Promise<OnboardingState | null> {
  const rows = await sql<OnboardingState[]>`
    select needs_profile, needs_job, job_unassigned, missing_credentials,
           outstanding_docs, needs_orientation, job_role::text as job_role
      from staff.onboarding_state
     where user_id = ${userId}
  `;
  return rows[0] ?? null;
}

/** The first unfinished step. Order matters and is not arbitrary: the
 *  job decides which credentials are asked for, and the documents are
 *  signed under a legal name the profile step establishes. */
export function stepFor(state: OnboardingState): Step {
  if (state.needs_profile) return "profile";
  if (state.needs_job) return "job";
  if (state.missing_credentials.length > 0) return "credentials";
  if (state.outstanding_docs > 0) return "documents";
  if (state.needs_orientation) return "orientation";
  return "done";
}

/** Every credential this job tracks, required or not, with whatever is
 *  already on file. The optional ones are shown alongside the required
 *  ones rather than hidden: somebody entering their BLS date has their
 *  wallet open, and that is the cheapest moment there will ever be to
 *  capture the rest. */
export async function requirementsFor(
  sql: StaffSql,
  userId: string,
  jobRole: string
): Promise<CredentialRequirement[]> {
  return sql<CredentialRequirement[]>`
    select req.kind::text as kind, req.required, req.label, req.hint,
           c.expires_on::text as expires_on
      from staff.job_credential_requirements req
      left join lateral (
        select expires_on
          from staff.credentials
         where user_id = ${userId} and kind = req.kind and active
         order by expires_on desc nulls last
         limit 1
      ) c on true
     where req.job_role = ${jobRole}::staff.job_role
       and req.active
     order by req.sort_order, req.label
  `;
}

/** Record credential expiry dates from the wizard.
 *
 *  UPSERT BY KIND, not insert-always: somebody who retypes a date after
 *  a failed submit should end up with one credential, not two. A renewal
 *  later in the person's life is a different act and goes through the
 *  roster, which keeps the superseded row.
 *
 *  DATES ONLY. Nothing here takes a certificate number, and there is no
 *  column to put one in. See supabase/staff-credentials.sql. */
export async function recordCredentials(
  sql: StaffSql,
  args: {
    org: string;
    userId: string;
    dates: { kind: string; expiresOn: string }[];
  }
): Promise<number> {
  let written = 0;
  for (const { kind, expiresOn } of args.dates) {
    const existing = await sql<{ id: string }[]>`
      select id from staff.credentials
       where user_id = ${args.userId} and kind = ${kind}::staff.credential_kind
         and active
       limit 1
    `;
    if (existing.length > 0) {
      await sql`
        update staff.credentials
           set expires_on = ${expiresOn}::date
         where id = ${existing[0].id}
      `;
    } else {
      await sql`
        insert into staff.credentials (org_slug, user_id, kind, expires_on)
        values (${args.org}, ${args.userId},
                ${kind}::staff.credential_kind, ${expiresOn}::date)
      `;
    }
    written += 1;
  }
  return written;
}

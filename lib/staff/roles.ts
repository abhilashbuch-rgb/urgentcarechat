import type { StaffRole } from "@/lib/staff/session";

// The role vocabulary, mirrored from the `staff.user_role` enum in
// supabase/staff-schema.sql. The database is the authority — this exists
// so the UI can label roles and decide what to render, not to decide what
// anyone is allowed to read. Access control lives in RLS.

export const ROLE_LABELS: Record<StaffRole, string> = {
  platform_super_admin: "Platform admin",
  org_admin: "Administrator",
  clinical_lead: "Clinical lead",
  staff: "Staff",
};

// The CLINIC JOB vocabulary, mirrored from the `staff.job_role` enum in
// supabase/staff-job-roles.sql. Separate from StaffRole above and not a
// rank: a job says what someone does on the floor, a role says what they
// may administer. A center admin is not "above" an x-ray tech; they are
// answering different questions.
export const JOB_LABELS: Record<string, string> = {
  front_desk: "Front desk",
  medical_assistant: "Medical assistant",
  xray_tech: "X-ray tech",
  provider: "Provider",
  center_admin: "Center admin",
};

/** The same jobs as they appear inside a sentence. A separate map rather
 *  than a rule applied to JOB_LABELS, because there is no rule: "as a
 *  medical assistant" works and "as a front desk" does not, and picking
 *  the article with a regex still leaves that one wrong. */
export const JOB_PHRASES: Record<string, string> = {
  front_desk: "on the front desk",
  medical_assistant: "as a medical assistant",
  xray_tech: "as an x-ray tech",
  provider: "as a provider",
  center_admin: "as the center admin",
};

/** Highest first. Used only for comparisons like "at least a clinical
 *  lead" — never as a substitute for a permission check on data. */
const RANK: Record<StaffRole, number> = {
  platform_super_admin: 3,
  org_admin: 2,
  clinical_lead: 1,
  staff: 0,
};

export function atLeast(role: StaffRole, minimum: StaffRole): boolean {
  return RANK[role] >= RANK[minimum];
}

export interface NavItem {
  href: string;
  label: string;
  minRole: StaffRole;
  /** Rendered but inert, with a "coming soon" marker. */
  placeholder?: boolean;
  note?: string;
  /** Shown only to people who practise: a provider or centre admin by
   *  JOB, or a clinical lead or above by ROLE. The two are different
   *  axes and most providers hold the plain "staff" role, so gating this
   *  on role alone would hide it from exactly the people it is for. */
  clinicalOnly?: boolean;
}

// One list, filtered by role. Hiding a link is a convenience, not a
// control: every route behind these links re-checks the session itself.
//
// THERE IS NO INTERNAL CHAT HERE, AND THAT IS THE DECISION, NOT AN
// OMISSION. A staff messaging module that records conversations is
// all-party consent in Pennsylvania (18 Pa. C.S. § 5703) and needs an
// employment attorney's sign-off on the consent flow before it can
// exist at all. It was carried as an inert placeholder for a while,
// which was worse than nothing: it advertised a feature the product
// had decided not to ship. Removed. If it comes back it comes back
// with the consent flow, not before.
export const NAV: NavItem[] = [
  { href: "/staff", label: "Today", minRole: "staff" },
  { href: "/staff/logs", label: "Logs", minRole: "staff" },
  { href: "/staff/rounds", label: "Rounds", minRole: "staff" },
  // Next to Logs rather than under an admin menu: the person who needs
  // it has just been stuck with a needle, and the record is required of
  // the employer whether or not a manager is on shift.
  { href: "/staff/records", label: "Record an event", minRole: "staff" },
  { href: "/staff/rules", label: "Rules", minRole: "staff" },
  // Emergency guides. Everyone, every job — the front desk needs the
  // lobby-recognition guide more than anybody, and gating life-safety
  // reference material behind a role is the wrong kind of tidiness.
  { href: "/staff/learning", label: "Emergencies", minRole: "staff" },
  { href: "/staff/documents", label: "Documents", minRole: "staff" },
  { href: "/staff/obligations", label: "Obligations", minRole: "staff" },
  // Clinical protocol search. Gated by JOB as well as role inside the
  // page and the route — a provider or centre admin gets it, and so
  // does a clinical lead, and nobody else. Listed for everyone at
  // "staff" would be a link that always refuses; listed at
  // clinical_lead alone would hide it from a provider whose account
  // role is plain staff, which is most providers. So it is filtered by
  // job below rather than by minRole.
  {
    href: "/staff/protocols",
    label: "Protocols",
    minRole: "staff",
    clinicalOnly: true,
  },
  // The WHOLE roster: everybody's credentials and the exclusion
  // screening. Leads and administrators. Everyone else has
  // /staff/documents, which is their own shelf and nobody else's.
  { href: "/staff/roster", label: "Roster", minRole: "clinical_lead" },
  { href: "/staff/me", label: "My record", minRole: "staff" },
  {
    href: "/staff/review",
    label: "Review",
    minRole: "clinical_lead",
    placeholder: true,
    note: "Approve or flag submitted logs.",
  },
  { href: "/staff/activity", label: "Activity", minRole: "org_admin" },
  // Last in the nav and administrator-only. Nothing here is touched on a
  // shift; it is set once when the clinic is created and revisited when
  // somebody's address changes.
  { href: "/staff/settings", label: "Settings", minRole: "org_admin" },
  { href: "/staff/accreditation", label: "Accreditation", minRole: "org_admin" },
  { href: "/staff/surveyor", label: "Inspection", minRole: "org_admin" },
  { href: "/staff/team", label: "Team", minRole: "org_admin" },
];

export function navFor(role: StaffRole, jobRole?: string | null): NavItem[] {
  const clinical =
    jobRole === "provider" ||
    jobRole === "center_admin" ||
    atLeast(role, "clinical_lead");

  return NAV.filter(
    (item) =>
      atLeast(role, item.minRole) && (!item.clinicalOnly || clinical)
  );
}

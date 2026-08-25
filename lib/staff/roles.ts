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

/**
 * The people who run the building: an owner by ROLE, or the centre admin
 * by JOB.
 *
 * The two axes come apart here more than anywhere else in the product. A
 * centre administrator is the person who knows whether there is an
 * autoclave in the back, which analyzer is on the counter, and what
 * arrived in last week's delivery — and their account role is very often
 * plain `staff`, because they do not administer billing. Gating "which
 * logs does this clinic run" on role alone would put that decision with
 * the one person who is not in the building.
 *
 * NOT the same as atLeast(role, "org_admin"). This deliberately does NOT
 * open the alert-routing, geofence or billing settings — who gets
 * telephoned when a vaccine fridge fails is the owner's decision and
 * stays on /staff/settings.
 */
export function runsClinic(role: StaffRole, jobRole?: string | null): boolean {
  return jobRole === "center_admin" || atLeast(role, "org_admin");
}

/** Five buckets instead of eighteen flat links: what you do on shift, your
 *  own stuff, what it takes to run the building, and what only an
 *  administrator touches. Today has no group — it is the dashboard and
 *  stays outside all four, rendered first and always visible without a
 *  tap. Chosen over grouping by compliance domain (logs with logs,
 *  people with people) because domain groups still mix a plain staff
 *  account's daily links with an administrator-only one in the same
 *  bucket; grouping by WHO USES IT tracks the access tiers already below,
 *  so a lower-permission account naturally gets fewer, smaller groups
 *  rather than a group with one item missing from it. */
export type NavGroup = "shift" | "record" | "clinic" | "admin";

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  shift: "My shift",
  record: "My record",
  clinic: "Run the clinic",
  admin: "Administer",
};

const NAV_GROUP_ORDER: NavGroup[] = ["shift", "record", "clinic", "admin"];

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
  /** Shown to whoever runs the building — see runsClinic(). Same reason
   *  as clinicalOnly and a different audience: the centre admin, whose
   *  account role is usually plain staff. */
  operatorOnly?: boolean;
  /** Which drawer group this renders under. Absent means standalone,
   *  above the groups — currently only Today. */
  group?: NavGroup;
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
  { href: "/staff/logs", label: "Logs", minRole: "staff", group: "shift" },
  { href: "/staff/rounds", label: "Rounds", minRole: "staff", group: "shift" },
  // Next to Logs rather than under an admin menu: the person who needs
  // it has just been stuck with a needle, and the record is required of
  // the employer whether or not a manager is on shift.
  { href: "/staff/records", label: "Record an event", minRole: "staff", group: "shift" },
  { href: "/staff/rules", label: "Rules", minRole: "staff", group: "shift" },
  // Emergency guides. Everyone, every job — the front desk needs the
  // lobby-recognition guide more than anybody, and gating life-safety
  // reference material behind a role is the wrong kind of tidiness.
  { href: "/staff/learning", label: "Emergencies", minRole: "staff", group: "shift" },
  { href: "/staff/documents", label: "Documents", minRole: "staff", group: "record" },
  // OSHA 300A postings and CLIA renewals are the administrator's
  // register, not a medical assistant's. Carrying it at staff level put
  // an item on every new hire's nav that they could open, could not act
  // on, and had to learn to ignore — and a nav you learn to ignore is
  // how the useful items lose their meaning too.
  { href: "/staff/obligations", label: "Obligations", minRole: "clinical_lead", group: "clinic" },
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
    group: "shift",
  },
  // The WHOLE roster: everybody's credentials and the exclusion
  // screening. Leads and administrators. Everyone else has
  // /staff/documents, which is their own shelf and nobody else's.
  { href: "/staff/roster", label: "Roster", minRole: "clinical_lead", group: "clinic" },
  { href: "/staff/me", label: "My record", minRole: "staff", group: "record" },
  {
    href: "/staff/review",
    label: "Review",
    minRole: "clinical_lead",
    placeholder: true,
    note: "Approve or flag submitted logs.",
    group: "admin",
  },
  { href: "/staff/activity", label: "Activity", minRole: "org_admin", group: "admin" },
  // WHICH LOGS THIS CLINIC RUNS — separate from Settings, and reachable
  // by the centre admin as well as the owner. Whether there is an
  // autoclave in the back room is a fact about the building, known to
  // the person standing in it. Alert routing and geofencing stay on
  // Settings, owner-only, because those are decisions about who is
  // accountable rather than about what equipment exists.
  {
    href: "/staff/settings/logs",
    label: "Clinic logs",
    minRole: "staff",
    operatorOnly: true,
    group: "clinic",
  },
  { href: "/staff/settings", label: "Settings", minRole: "org_admin", group: "admin" },
  { href: "/staff/accreditation", label: "Accreditation", minRole: "org_admin", group: "clinic" },
  { href: "/staff/surveyor", label: "Inspection", minRole: "org_admin", group: "clinic" },
  { href: "/staff/team", label: "Team", minRole: "org_admin", group: "admin" },
];

export function navFor(role: StaffRole, jobRole?: string | null): NavItem[] {
  const clinical =
    jobRole === "provider" ||
    jobRole === "center_admin" ||
    atLeast(role, "clinical_lead");

  const operator = runsClinic(role, jobRole);

  return NAV.filter(
    (item) =>
      atLeast(role, item.minRole) &&
      (!item.clinicalOnly || clinical) &&
      (!item.operatorOnly || operator)
  );
}

export interface NavGroupResult {
  group: NavGroup;
  label: string;
  items: NavItem[];
}

/** navFor()'s items, split into the standalone top link (Today) and the
 *  four groups below it — each present only if it has something to show,
 *  so a plain staff account never renders an empty "Administer". */
export function groupedNavFor(
  role: StaffRole,
  jobRole?: string | null
): { top: NavItem[]; groups: NavGroupResult[] } {
  const items = navFor(role, jobRole);
  const top = items.filter((item) => !item.group);
  const groups = NAV_GROUP_ORDER.map((group) => ({
    group,
    label: NAV_GROUP_LABELS[group],
    items: items.filter((item) => item.group === group),
  })).filter((g) => g.items.length > 0);

  return { top, groups };
}

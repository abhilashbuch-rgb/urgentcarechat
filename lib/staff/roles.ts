import type { StaffRole } from "@/lib/staff/session";

// The role vocabulary, mirrored from the `staff.user_role` enum in
// supabase/staff-schema.sql. The database is the authority — this exists
// so the UI can label roles and decide what to render, not to decide what
// anyone is allowed to read. Access control lives in RLS.

export const ROLE_LABELS: Record<StaffRole, string> = {
  platform_super_admin: "Platform admin",
  org_admin: "Administrator",
  manager: "Manager",
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
  billing_specialist: "Billing specialist",
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
  billing_specialist: "as a billing specialist",
};

/** medical_assistant reads as a different job depending on what the
 *  clinic actually is — see the facility_type check in
 *  staff-facility.sql. A dental practice's chairside clinical role is
 *  called a dental assistant, not a medical assistant, even though it
 *  is the exact same staff.job_role value doing the exact same
 *  sedation-check and amalgam-separator tasks underneath. Forking the
 *  enum over a title would mean reseeding every dental template's
 *  job_roles array for a wording difference, so the value stays one
 *  thing and only the word shown for it changes.
 *
 *  Everything else in JOB_LABELS/JOB_PHRASES already reads the same
 *  across every facility_type this product has today, so this is the
 *  one case, not the start of a general per-vertical dictionary. */
export function jobLabel(jobRole: string, facilityType?: string | null): string {
  if (jobRole === "medical_assistant" && facilityType === "dental") return "Dental assistant";
  return JOB_LABELS[jobRole] ?? jobRole;
}

export function jobPhrase(jobRole: string, facilityType?: string | null): string {
  if (jobRole === "medical_assistant" && facilityType === "dental") return "as a dental assistant";
  return JOB_PHRASES[jobRole] ?? jobRole;
}

/** Highest first. Used only for comparisons like "at least a clinical
 *  lead" — never as a substitute for a permission check on data.
 *
 *  MANAGER SITS JUST BELOW OWNER, NOT BESIDE CLINICAL LEAD. A manager
 *  runs the team — invites, deactivates, sees the same roster, the same
 *  register, the same audit trail an owner does — and is deliberately
 *  ranked above clinical_lead so every gate written as
 *  atLeast(role, "clinical_lead") already includes them. The one thing
 *  a manager cannot reach is what an owner alone should decide: money.
 *  See the ORG_ADMIN-ONLY, DELIBERATELY markers on the clinics/billing
 *  page and the invite route for where that line actually sits — it is
 *  drawn per-route, not by rank alone, because rank alone cannot express
 *  "sees everything, cannot spend anything." */
const RANK: Record<StaffRole, number> = {
  platform_super_admin: 4,
  org_admin: 3,
  manager: 2,
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
 * open billing — who pays for the clinic is the owner's decision alone,
 * enforced separately on /staff/settings/clinics. Alert routing and
 * geofencing now DO open to a manager along with everything else they
 * run; see the rank comment on RANK for why that line moved.
 */
export function runsClinic(role: StaffRole, jobRole?: string | null): boolean {
  return jobRole === "center_admin" || atLeast(role, "manager");
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
  /** Shown to whoever runs the building — see runsClinic(): the centre
   *  admin by JOB, or a manager or above by ROLE. The two are different
   *  axes, and a centre admin's account role is usually plain "staff",
   *  so gating this on role alone would hide it from exactly the person
   *  it is for. */
  operatorOnly?: boolean;
  /** Reachable by this exact job, REGARDLESS of minRole — the same
   *  "job and role are different axes" reasoning as operatorOnly, for a
   *  case operatorOnly doesn't cover: one specific job (not "whoever
   *  runs the building") that needs a page an ordinary staff role
   *  can't otherwise reach. minRole still applies for everyone else —
   *  an org_admin sees this item on rank alone; a billing specialist,
   *  plain "staff" by role, sees it only because their job matches. */
  extraJobRoles?: string[];
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
  // A quick number for billing, not a compliance log — see
  // supabase/staff-billing-stats.sql. Anyone on shift can file it, same
  // as a log; only the recipient it emails is owner-only, set on
  // Settings, never here.
  { href: "/staff/billing-stats", label: "Patient count", minRole: "staff", group: "shift" },
  // Emergency guides, and — folded into the same page below the
  // guides — clinical protocol search. Everyone, every job, gets this
  // link: the front desk needs the lobby-recognition guide more than
  // anybody, and gating life-safety reference material behind a role
  // is the wrong kind of tidiness. The protocol-search section inside
  // the page still checks job/role itself (provider, centre admin, or
  // clinical_lead+) and simply doesn't render for anyone else — one
  // door, the same two audiences as before behind it. See
  // app/staff/learning/page.tsx.
  { href: "/staff/learning", label: "Emergencies & protocols", minRole: "staff", group: "shift" },
  { href: "/staff/documents", label: "Documents", minRole: "staff", group: "record" },
  // OSHA 300A postings and CLIA renewals are the administrator's
  // register, not a medical assistant's. Carrying it at staff level put
  // an item on every new hire's nav that they could open, could not act
  // on, and had to learn to ignore — and a nav you learn to ignore is
  // how the useful items lose their meaning too.
  { href: "/staff/obligations", label: "Obligations", minRole: "clinical_lead", group: "clinic" },
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
  { href: "/staff/activity", label: "Activity", minRole: "manager", group: "admin" },
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
  // AN ADD-ON, SHOWN REGARDLESS OF WHETHER THIS CLINIC HAS IT ON. The
  // page itself checks staff.orgs.inventory_addon_enabled and shows a
  // plain "not turned on yet" state when it's off — see
  // app/staff/inventory/page.tsx. navFor() has no per-org data to
  // filter on, only role and job, so hiding the link per-org would mean
  // widening this function's signature for one item; a visible link
  // that explains itself costs less and doubles as the way an operator
  // finds out the add-on exists at all.
  {
    href: "/staff/inventory",
    label: "Inventory",
    minRole: "staff",
    operatorOnly: true,
    group: "clinic",
  },
  // Billing/subscription itself lives one level deeper, at
  // /staff/settings/clinics, and stays org_admin-only — this page is the
  // clinic's operating settings (alert routing, geofencing, reports),
  // which a manager runs day to day same as an owner does.
  { href: "/staff/settings", label: "Settings", minRole: "manager", group: "admin" },
  { href: "/staff/accreditation", label: "Accreditation", minRole: "manager", group: "clinic" },
  { href: "/staff/surveyor", label: "Inspection", minRole: "manager", group: "clinic" },
  { href: "/staff/team", label: "Team", minRole: "manager", group: "admin" },
  // ORG_ADMIN, NOT MANAGER — see RANK's own comment above: a manager
  // runs the team, not money, and a write-off is money. The billing
  // specialist herself reaches this through extraJobRoles instead,
  // since her account role is plain "staff" the same way a centre
  // admin's usually is.
  {
    href: "/staff/billing-report",
    label: "Billing report",
    minRole: "org_admin",
    extraJobRoles: ["billing_specialist"],
    group: "clinic",
  },
];

export function navFor(role: StaffRole, jobRole?: string | null): NavItem[] {
  const operator = runsClinic(role, jobRole);

  return NAV.filter(
    (item) =>
      (item.extraJobRoles && !!jobRole && item.extraJobRoles.includes(jobRole)) ||
      (atLeast(role, item.minRole) && (!item.operatorOnly || operator))
  );
}

// Which shortcut a job reaches for first, on the Today page's tile grid
// — see app/components/staff/ShortcutGrid.tsx. Resequences navFor()'s
// own output; adds and removes nothing, so a tile can never appear here
// that the drawer nav itself would refuse.
//
// ONLY FRONT_DESK HAS AN OVERRIDE. Every other job — medical_assistant
// included — keeps navFor()'s declaration order, which already leads
// with the clinical tools (Logs, Rounds) most jobs reach for first, and
// there's no equally concrete reason on file to reorder it further.
// Front desk is different for a documented reason: the emergencies page
// itself says "the front desk needs the lobby-recognition guide more
// than anybody" (app/staff/learning/page.tsx), and Patient count is a
// front-desk metric by name (see supabase/staff-billing-stats.sql).
const SHORTCUT_PRIORITY: Partial<Record<string, string[]>> = {
  front_desk: [
    "/staff/learning",
    "/staff/billing-stats",
    "/staff/records",
    "/staff/logs",
    "/staff/rounds",
    "/staff/rules",
    "/staff/documents",
    "/staff/me",
  ],
};

export function shortcutsFor(role: StaffRole, jobRole?: string | null): NavItem[] {
  const items = navFor(role, jobRole);
  const priority = jobRole ? SHORTCUT_PRIORITY[jobRole] : undefined;
  if (!priority) return items;

  return [...items].sort((a, b) => {
    const ai = priority.indexOf(a.href);
    const bi = priority.indexOf(b.href);
    return (ai === -1 ? priority.length : ai) - (bi === -1 ? priority.length : bi);
  });
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

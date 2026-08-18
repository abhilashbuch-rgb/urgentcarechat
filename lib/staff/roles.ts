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
  { href: "/staff/me", label: "My record", minRole: "staff" },
  { href: "/staff/logs", label: "Logs", minRole: "staff" },
  { href: "/staff/obligations", label: "Obligations", minRole: "staff" },
  { href: "/staff/roster", label: "Roster", minRole: "clinical_lead" },
  {
    href: "/staff/review",
    label: "Review",
    minRole: "clinical_lead",
    placeholder: true,
    note: "Approve or flag submitted logs.",
  },
  { href: "/staff/team", label: "Team", minRole: "org_admin" },
];

export function navFor(role: StaffRole): NavItem[] {
  return NAV.filter((item) => atLeast(role, item.minRole));
}

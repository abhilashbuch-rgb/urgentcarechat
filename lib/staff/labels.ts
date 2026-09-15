// Display names for the category slugs stored on policy documents. The
// database keeps the slug; only the UI needs the human wording, so this
// is the one place it lives.

export const CATEGORY_LABELS: Record<string, string> = {
  hipaa: "Privacy & security",
  osha: "Workplace safety",
  clinical: "Clinical",
  hr: "Employment",
  operations: "Operations",
};

// ISO weekday numbers (1=Monday..7=Sunday), matching staff.users.workdays
// — see supabase/staff-workdays.sql. Full names, for reading a schedule
// back in a sentence; the short Mon/Tue/... chips on the admin schedule
// picker (app/staff/team/[id]/page.tsx) are their own, deliberately
// compact list for a checkbox row, not a duplicate of this one.
export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

/** "Not set yet" for an empty schedule — see staff-workdays.sql's own
 *  comment on why empty means unset, not "never works." Otherwise the
 *  days in order, by name, the way a person reads their own schedule
 *  back rather than the picker's own Mon/Tue/Wed shorthand. */
export function workdaysLabel(workdays: number[]): string {
  if (workdays.length === 0) return "Not set yet";
  return workdays.map((d) => WEEKDAY_LABELS[d]).filter(Boolean).join(", ");
}

/** The short chip list the recurring workday picker uses
 *  (app/staff/team/[id]/page.tsx) — grouped here with WEEKDAY_LABELS
 *  and workdaysLabel() rather than declared inline, since all three
 *  read the same 1=Monday..7=Sunday convention. */
export const WEEKDAY_CHIPS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

// One timezone for every rendered timestamp. The stored value is always
// UTC; this is only how it is shown.
const RECORD_TZ = "America/New_York";

/** Dates in a compliance record are read by people checking whether
 *  something was done in time, so they get an unambiguous format rather
 *  than the locale's.
 *
 *  DEFAULTS TO EASTERN, NOT BECAUSE THAT IS CORRECT — because most call
 *  sites have no org in scope to ask. Pass the org's real IANA timezone
 *  (staff.orgs.timezone, the same field lib/staff/alerts.ts's
 *  localStamp() already reads correctly) wherever it is available;
 *  hardcoding it here for every clinic is the same class of bug that
 *  file exists to avoid, not a design choice. */
export function formatSignedAt(iso: string | null, tz: string = RECORD_TZ): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      timeZoneName: "short",
    });
  } catch {
    // An invalid zone must not blank out a signature's timestamp.
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: RECORD_TZ,
      timeZoneName: "short",
    });
  }
}

/** Just the clock time, for a confirmation read seconds after the thing
 *  happened. The date is "today" and saying so adds nothing. */
export function formatTimeOnly(iso: string | null): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: RECORD_TZ,
  });
}

/** First token of whatever name is on file, for a greeting — "Hello,
 *  David," not "Hello, David Buch." Same fallback chain /staff/me uses
 *  to decide what to call somebody, so the two never disagree. */
export function firstNameOf(
  profile: { name: string | null; legal_name: string | null } | null | undefined
): string | null {
  const full = profile?.name ?? profile?.legal_name ?? null;
  if (!full) return null;
  return full.trim().split(/\s+/)[0] || null;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

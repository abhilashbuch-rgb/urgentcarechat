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

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

/** Dates in a compliance record are read by people checking whether
 *  something was done in time, so they get an unambiguous format rather
 *  than the locale's. */
export function formatSignedAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
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

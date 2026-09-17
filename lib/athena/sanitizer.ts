/**
 * Zero-PHI sanitization middleware for anything read back from
 * athenahealth.
 *
 * WHY THIS EXISTS EVEN THOUGH WE DON'T TALK TO PATIENT ENDPOINTS. This
 * product's whole HIPAA posture (see app/security/page.tsx) rests on
 * "no patient table in this product's schema." The athenahealth calls
 * this integration is meant to make — departments, staff roster,
 * uploading a facility-level admin document — are all practice-level,
 * not patient-level, so nothing here should ever contain PHI. This is
 * the belt-and-suspenders check for that assumption: a defensive
 * strip-and-log pass between "athenahealth sent us JSON" and "that JSON
 * touches our database," so a scope-creeping field on their side (or a
 * future engineer widening a sync to a chart-level endpoint by mistake)
 * gets caught here instead of landing in a table this product tells
 * its customers has no patient data in it.
 *
 * WHAT IT DOES NOT DO: guess. It removes fields by name from a fixed,
 * conservative list — it does not try to detect a name or a date of
 * birth by shape, which would be both unreliable and a worse failure
 * mode (an MRN-shaped staff employee ID silently vanishing is exactly
 * the kind of "clever" bug that hides a real integration problem).
 */

// Case-insensitive, checked against the field name only — not nested
// path — so "patient.mrn" and "encounter.patientMrn" both match on
// "mrn". Deliberately broad: a false positive here is a stripped field
// worth investigating; a false negative is PHI in the database.
const PHI_FIELD_NAMES = [
  "patientid",
  "patientfirstname",
  "patientlastname",
  "patientname",
  "patientdob",
  "dob",
  "dateofbirth",
  "ssn",
  "socialsecuritynumber",
  "mrn",
  "medicalrecordnumber",
  "insuranceid",
  "insurancemember",
  "guarantorid",
  "chartid",
];

function isPhiField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  return PHI_FIELD_NAMES.some((phi) => normalized.includes(phi));
}

export interface SanitizeResult {
  clean: unknown;
  stripped: string[];
}

/**
 * Recursively strips any object key matching the PHI list above.
 * `stripped` carries the dotted path of every field removed, for the
 * audit_log entry the caller should write — silently dropping a field
 * athenahealth sent us is worse than dropping it loudly.
 */
export function sanitizeForAthena(value: unknown, path = ""): SanitizeResult {
  const stripped: string[] = [];
  const clean = stripRecursive(value, path, stripped);
  return { clean, stripped };
}

function stripRecursive(value: unknown, path: string, stripped: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item, i) => stripRecursive(item, `${path}[${i}]`, stripped));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const fieldPath = path ? `${path}.${key}` : key;
      if (isPhiField(key)) {
        stripped.push(fieldPath);
        continue;
      }
      out[key] = stripRecursive(v, fieldPath, stripped);
    }
    return out;
  }
  return value;
}

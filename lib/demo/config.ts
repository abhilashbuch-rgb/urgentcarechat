// The demo's facility archetypes and the modules each one offers.
//
// A FIXTURE THAT MIRRORS THE DATABASE, ON PURPOSE. The real mapping
// lives in staff.facility_templates and the real defaults in
// form_templates.optional/active. This file restates a slice of both.
//
// It could have queried them instead — and then the demo would hold a
// database connection, which is the one thing app/demo/layout.tsx
// promises it does not: "no session, touches no database, calls no API
// route". That promise is what makes it safe to hand the link to
// anybody. So the price is that this file has to be kept honest by hand,
// and the comment saying so is the whole mitigation.
//
// KEPT SHORT FOR THE SAME REASON. Three archetypes, not five: a prospect
// is choosing a shape, not filling in a form. Ambulatory surgery and
// dental exist in the product and are left off the demo deliberately.

export interface DemoModule {
  key: string;
  label: string;
  /** What it is, in the words somebody buying would use. */
  blurb: string;
  /** On or off when the archetype is first picked. Mirrors the library
   *  row's `active` — autoclave off everywhere, the rest on. */
  on: boolean;
  /** Who files it. Drives the role map in step three. */
  job: "medical_assistant" | "xray_tech" | "front_desk" | "center_admin";
}

export interface Archetype {
  key: string;
  label: string;
  /** The label inside a sentence. A separate field rather than a rule
   *  applied to `label`, for the same reason JOB_PHRASES exists in
   *  lib/staff/roles.ts: there is no rule. "a urgent care" is what
   *  picking the article with a regex gets you, and "a med spa office"
   *  is what a template gets you. */
  phrase: string;
  blurb: string;
  modules: DemoModule[];
}

const AUTOCLAVE: DemoModule = {
  key: "autoclave",
  label: "Autoclave loads",
  blurb:
    "One record per cycle: contents, temperature, exposure, indicator. Off unless you actually sterilize instruments.",
  on: false,
  job: "medical_assistant",
};

const URINALYSIS: DemoModule = {
  key: "urinalysis",
  label: "Urinalysis controls & strips",
  blurb:
    "Both controls, plus the strip bottle itself — lot, expiry, desiccant, whether the cap was left open.",
  on: true,
  job: "medical_assistant",
};

const XRAY: DemoModule = {
  key: "xray",
  label: "Lead apron inspection",
  blurb:
    "Quarterly check of every apron and thyroid shield. Off if there is no x-ray suite.",
  on: true,
  job: "xray_tech",
};

const LASER: DemoModule = {
  key: "laser",
  label: "Laser safety",
  blurb:
    "Key control, eyewear, warning signage and the treatment settings used.",
  on: true,
  job: "medical_assistant",
};

export const ARCHETYPES: Archetype[] = [
  {
    key: "urgent_care",
    label: "Urgent care",
    phrase: "an urgent care",
    blurb: "Walk-in, x-ray on site, CLIA-waived testing.",
    modules: [XRAY, URINALYSIS, AUTOCLAVE],
  },
  {
    key: "primary_care",
    label: "Primary care",
    phrase: "a primary care office",
    blurb: "Scheduled visits, vaccines, in-house testing.",
    modules: [URINALYSIS, AUTOCLAVE],
  },
  {
    key: "med_spa",
    label: "Med spa",
    phrase: "a med spa",
    blurb: "Injectables, lasers, no walk-in urgent care.",
    modules: [LASER, AUTOCLAVE],
  },
];

/**
 * What every clinic carries whatever it picks — shown in the wizard
 * WITHOUT a toggle.
 *
 * This is the honest half of the pitch and it is the half a
 * configuration screen usually hides. A buyer toggling four switches can
 * come away believing the whole product is optional, and then discover
 * on an inspection that the sharps log they never saw was required of
 * them the entire time. Showing these as fixed, beside the ones that
 * move, says what the product is for: the clinic chooses what equipment
 * it has, never what the law asks of it.
 */
export const REQUIRED: { label: string; why: string }[] = [
  { label: "Refrigerator temperatures", why: "Vaccine storage" },
  { label: "Crash cart & AED", why: "Emergency readiness" },
  { label: "Controlled substance count", why: "Dual-witness count" },
  { label: "Sharps containers", why: "29 CFR 1910.1030" },
  { label: "Fire extinguishers", why: "29 CFR 1910.157(e)(2)" },
  { label: "Hazardous chemical inventory", why: "29 CFR 1910.1200" },
  { label: "Exposure & sharps injury", why: "29 CFR 1910.1030(h)" },
];

export const JOB_LABEL: Record<DemoModule["job"], string> = {
  medical_assistant: "Medical assistant",
  xray_tech: "X-ray tech",
  front_desk: "Front desk",
  center_admin: "Center admin",
};

/** The chosen config, carried in the URL rather than in a session — the
 *  demo has no session, and a link that reproduces somebody's exact
 *  configuration is worth more to a salesperson than one that does not. */
export function encodeConfig(archetype: string, on: string[]): string {
  return [archetype, ...on.slice().sort()].join(".");
}

export function decodeConfig(raw: string | undefined): {
  archetype: Archetype;
  on: Set<string>;
} {
  const parts = (raw ?? "").split(".").filter(Boolean);
  const archetype = ARCHETYPES.find((a) => a.key === parts[0]) ?? ARCHETYPES[0];
  // Unknown keys are dropped rather than trusted: this string comes out
  // of a URL somebody can edit.
  const known = new Set(archetype.modules.map((m) => m.key));
  const on = new Set(parts.slice(1).filter((k) => known.has(k)));
  return { archetype, on };
}

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
// FIVE ARCHETYPES, MATCHING THE PRODUCT. Ambulatory surgery and dental
// used to be left off deliberately, on the reasoning that a prospect is
// choosing a shape, not filling in a form. That held while three covered
// most of who signed up; it stopped holding once a surgery center owner
// or a dentist landed here and saw two shapes that were not theirs. The
// "not a form" argument still governs how each archetype is described —
// a couple of modules, not every template it actually seeds.

export interface DemoModule {
  key: string;
  /** The real staff.form_templates slug this stands for. THE ONE PLACE
   *  the demo's vocabulary meets the product's — a visitor who converts
   *  carries these keys to /start, and this is what turns them back into
   *  templates. Anything not in this list is dropped rather than trusted. */
  slug: string;
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
  slug: "autoclave-load",
  label: "Autoclave loads",
  blurb:
    "One record per cycle: contents, temperature, exposure, indicator. Off unless you actually sterilize instruments.",
  on: false,
  job: "medical_assistant",
};

const URINALYSIS: DemoModule = {
  key: "urinalysis",
  slug: "urinalysis-qc",
  label: "Urinalysis controls & strips",
  blurb:
    "Both controls, plus the strip bottle itself — lot, expiry, desiccant, whether the cap was left open.",
  on: true,
  job: "medical_assistant",
};

const XRAY: DemoModule = {
  key: "xray",
  slug: "radiation-apron",
  label: "Lead apron inspection",
  blurb:
    "Quarterly check of every apron and thyroid shield. Off if there is no x-ray suite.",
  on: true,
  job: "xray_tech",
};

const LASER: DemoModule = {
  key: "laser",
  slug: "laser-safety",
  label: "Laser safety",
  blurb:
    "Key control, eyewear, warning signage and the treatment settings used.",
  on: true,
  job: "medical_assistant",
};

const RECALL_CHECK: DemoModule = {
  key: "recall_check",
  slug: "recall-check",
  label: "Monthly recall check",
  blurb:
    "This month's injectable lots checked against FDA's recall list — before a patient tells you about one.",
  on: true,
  job: "medical_assistant",
};

const ADVERSE_EVENT: DemoModule = {
  key: "adverse_event",
  slug: "adverse-event-review",
  label: "Adverse event review",
  blurb:
    "Every complication this month, reviewed and signed off by the medical director.",
  on: true,
  job: "medical_assistant",
};

const MH_CART: DemoModule = {
  key: "mh_cart",
  slug: "mh-cart",
  label: "Malignant hyperthermia cart",
  blurb:
    "Dantrolene stock and the adjuncts, checked weekly — the MHAUS standard a surveyor checks first.",
  on: true,
  job: "medical_assistant",
};

const STERILE_PROCESSING: DemoModule = {
  key: "sterile_processing",
  slug: "sterile-processing",
  label: "Sterile processing",
  blurb:
    "Every load recorded, with the biological indicator that actually proves an instrument is sterile.",
  on: true,
  job: "medical_assistant",
};

const SEDATION: DemoModule = {
  key: "sedation",
  slug: "sedation-check",
  label: "Sedation & nitrous safety",
  blurb:
    "Scavenging, monitors, reversal agents and the emergency kit, checked before the first patient.",
  on: true,
  job: "medical_assistant",
};

const AMALGAM: DemoModule = {
  key: "amalgam",
  slug: "amalgam-separator",
  label: "Amalgam separator",
  blurb:
    "Canister level and vacuum-line cleaning — EPA's dental effluent rule, 40 CFR Part 441.",
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
    modules: [LASER, AUTOCLAVE, RECALL_CHECK, ADVERSE_EVENT],
  },
  {
    key: "ambulatory_surgery",
    label: "Surgery center",
    phrase: "a surgery center",
    blurb: "Same-day procedures, sedation or general anesthesia, no overnight stay.",
    modules: [MH_CART, STERILE_PROCESSING],
  },
  {
    key: "dental",
    label: "Dental",
    phrase: "a dental practice",
    blurb: "Oral surgery, sedation, amalgam and sharps handled daily.",
    modules: [SEDATION, AMALGAM],
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
  { label: "Fire & life safety", why: "29 CFR 1910.157(e)(2)" },
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

/** Every module across every archetype, keyed by its demo key. Used when
 *  a demo configuration is carried into a real signup. */
export const ALL_MODULES: Record<string, DemoModule> = Object.fromEntries(
  ARCHETYPES.flatMap((a) => a.modules).map((m) => [m.key, m])
);

/**
 * Turns a demo config string into the template slugs to switch on and
 * off after a clinic is provisioned.
 *
 * NOT TRUSTED. The string arrives in a URL a visitor can edit, so
 * anything outside the archetype's own module list is dropped here — and
 * staff.set_log_enabled() refuses a non-optional template underneath
 * that anyway, so naming sharps-containers gets you nothing twice over.
 */
export function modulesFromConfig(
  raw: string | undefined
): { slug: string; on: boolean }[] {
  const parts = (raw ?? "").split(".").filter(Boolean);
  const archetype = ARCHETYPES.find((a) => a.key === parts[0]);
  if (!archetype) return [];

  const known = new Set(archetype.modules.map((m) => m.key));
  const wanted = parts.slice(1);

  // AN UNRECOGNISED KEY VOIDS THE WHOLE STRING, rather than being dropped
  // on its own.
  //
  // Dropping it individually looks safer and is worse. "urgent_care" plus
  // two keys this build has never heard of would read as "the archetype,
  // with none of its modules on" — so a mangled or stale link would hand
  // somebody a clinic with the lead apron inspection switched OFF, which
  // is a worse starting point than never having opened the demo. A
  // wizard link never contains an unknown key; a tampered or outdated one
  // does, and for both of those the honest answer is the library
  // defaults.
  //
  // The archetype on its own, with no module keys, is NOT this case: that
  // is what the wizard produces when somebody switches everything off,
  // and it is honoured.
  if (wanted.some((k) => !known.has(k))) return [];

  const on = new Set(wanted);
  return archetype.modules.map((m) => ({ slug: m.slug, on: on.has(m.key) }));
}

/** The facility_type a demo archetype corresponds to. Same strings as
 *  the CHECK on staff.orgs.facility_type, by construction. */
export function facilityFromConfig(raw: string | undefined): string | null {
  const key = (raw ?? "").split(".")[0];
  return ARCHETYPES.some((a) => a.key === key) ? key : null;
}

/** "a", "a and b", "a, b and c" — no serial comma, matching the rest of
 *  the product's copy. Shared so the demo's offer and the signup screen
 *  describe the same choices in the same words. */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

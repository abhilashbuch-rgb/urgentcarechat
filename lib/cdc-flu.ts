// Client for CDC flu surveillance data via the free Delphi Epidata API
// (https://api.delphi.cmu.edu/epidata/fluview/), no key required at this
// volume. Used by /reads for a general flu-activity banner — fails soft,
// never throws, since this is decorative context, not triage-critical.

export type FluLevel = "low" | "moderate" | "high" | "unknown";

/** Whether a reading is for the state itself or the wider region it falls in. */
export type FluScope = "state" | "region";

export interface FluActivity {
  level: FluLevel;
  weightedIli: number | null;
  epiweek: number | null;
  state: string;
  /** Display name for whatever `weightedIli` actually covers — the state, or
   *  the multi-state region when the state doesn't report. */
  label: string;
  scope: FluScope;
}

// Every jurisdiction ILINet reports for, so the banner can follow the
// visitor instead of being pinned to one state.
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "the District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", VI: "the U.S. Virgin Islands",
};

// Delphi's region codes are NOT simply lowercased state abbreviations.
// New York reports as "ny_minus_jfk" (state excluding NYC, which reports
// separately as "jfk"); a plain "ny" is rejected with result:-2, which this
// code previously sent — so NY silently reported "unknown" forever.
const REGION_OVERRIDES: Record<string, string> = {
  NY: "ny_minus_jfk",
};

const STATE_TO_REGION: Record<string, string> = Object.fromEntries(
  Object.keys(STATE_NAMES).map((s) => [s, REGION_OVERRIDES[s] ?? s.toLowerCase()])
);

// Display labels. Same as the state name except where the reporting region
// isn't actually the whole state, which the reader deserves to know.
export const STATE_LABELS: Record<string, string> = {
  ...STATE_NAMES,
  NY: "New York (excl. NYC)",
};

export function isTrackedState(state: string): boolean {
  return Object.hasOwn(STATE_TO_REGION, state.toUpperCase());
}

// Seven jurisdictions (AK, CT, HI, OK, OR, SD, UT) don't publish
// state-level ILINet through this endpoint at all — verified against live
// data, and widening the lookback window doesn't help, so it isn't
// reporting lag. For a visitor in one of those, the HHS region they belong
// to does report, and "flu activity in your multi-state region" is far
// better than a blank banner. Every state gets a mapping so the fallback
// works for anyone who drops out of state-level reporting later.
const HHS_REGIONS: { code: string; label: string; states: string[] }[] = [
  { code: "hhs1", label: "New England", states: ["CT", "ME", "MA", "NH", "RI", "VT"] },
  { code: "hhs2", label: "the NY/NJ region", states: ["NJ", "NY", "PR", "VI"] },
  { code: "hhs3", label: "the Mid-Atlantic", states: ["DE", "DC", "MD", "PA", "VA", "WV"] },
  { code: "hhs4", label: "the Southeast", states: ["AL", "FL", "GA", "KY", "MS", "NC", "SC", "TN"] },
  { code: "hhs5", label: "the Great Lakes region", states: ["IL", "IN", "MI", "MN", "OH", "WI"] },
  { code: "hhs6", label: "the South Central region", states: ["AR", "LA", "NM", "OK", "TX"] },
  { code: "hhs7", label: "the Central Plains", states: ["IA", "KS", "MO", "NE"] },
  { code: "hhs8", label: "the Mountain region", states: ["CO", "MT", "ND", "SD", "UT", "WY"] },
  { code: "hhs9", label: "the Southwest & Pacific", states: ["AZ", "CA", "HI", "NV"] },
  { code: "hhs10", label: "the Pacific Northwest", states: ["AK", "ID", "OR", "WA"] },
];

const STATE_TO_HHS: Record<string, { code: string; label: string }> =
  Object.fromEntries(
    HHS_REGIONS.flatMap((r) =>
      r.states.map((s) => [s, { code: r.code, label: r.label }])
    )
  );

export const TRACKED_STATES = ["PA", "NJ", "NY", "DE", "MD"] as const;

interface EpidataRow {
  epiweek: number;
  wili: number | null;
  ili: number | null;
}

interface EpidataResponse {
  result: number;
  epidata?: EpidataRow[];
  message?: string;
}

// MMWR/CDC epiweek for a given date: Sunday-Saturday weeks, week 1 is the
// first week of the year with at least 4 days in that calendar year.
function epiweekFor(date: Date): number {
  const year = date.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1Day = jan1.getUTCDay(); // 0 = Sunday

  const week1Start = new Date(jan1);
  if (jan1Day <= 3) {
    week1Start.setUTCDate(jan1.getUTCDate() - jan1Day);
  } else {
    week1Start.setUTCDate(jan1.getUTCDate() + (7 - jan1Day));
  }

  if (date < week1Start) {
    // Falls in the last MMWR week of the previous year.
    return epiweekFor(new Date(week1Start.getTime() - 86400000));
  }

  const diffDays = Math.floor((date.getTime() - week1Start.getTime()) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  return year * 100 + week;
}

function classify(weightedIli: number): FluLevel {
  if (weightedIli < 2) return "low";
  if (weightedIli < 4) return "moderate";
  return "high";
}

function unknown(state: string): FluActivity {
  const abbrev = state.toUpperCase();
  return {
    level: "unknown",
    weightedIli: null,
    epiweek: null,
    state: abbrev,
    label: STATE_LABELS[abbrev] ?? state,
    scope: "state",
  };
}

export async function fetchFluActivity(stateAbbrev: string): Promise<FluActivity> {
  const abbrev = stateAbbrev.toUpperCase();
  const state = await fetchForRegion(
    STATE_TO_REGION[abbrev],
    abbrev,
    STATE_LABELS[abbrev] ?? stateAbbrev,
    "state"
  );
  if (state.level !== "unknown") return state;

  // No state-level reading — try the multi-state HHS region this state
  // belongs to before giving up.
  const hhs = STATE_TO_HHS[abbrev];
  if (!hhs) return state;

  return fetchForRegion(hhs.code, abbrev, hhs.label, "region");
}

async function fetchForRegion(
  region: string | undefined,
  stateAbbrev: string,
  label: string,
  scope: FluScope
): Promise<FluActivity> {
  if (!region) return unknown(stateAbbrev);

  try {
    const now = new Date();
    const threeWeeksAgo = new Date(now.getTime() - 21 * 86400000);
    const startWeek = epiweekFor(threeWeeksAgo);
    const endWeek = epiweekFor(now);

    const url = `https://api.delphi.cmu.edu/epidata/fluview/?regions=${region}&epiweeks=${startWeek}-${endWeek}`;
    const res = await fetch(url);
    if (!res.ok) return unknown(stateAbbrev);

    const data: EpidataResponse = await res.json();
    if (data.result !== 1 || !data.epidata?.length) return unknown(stateAbbrev);

    const latest = data.epidata.reduce((a, b) => (b.epiweek > a.epiweek ? b : a));
    const weightedIli = latest.wili ?? latest.ili ?? null;
    if (weightedIli === null) return unknown(stateAbbrev);

    return {
      level: classify(weightedIli),
      weightedIli,
      epiweek: latest.epiweek,
      state: stateAbbrev.toUpperCase(),
      label,
      scope,
    };
  } catch {
    return unknown(stateAbbrev);
  }
}

// ============================================================
// Multi-state weekly series, for the /monitor trend chart. One request
// covers every state, so this is a single round trip rather than five.
// ============================================================
export interface FluPoint {
  epiweek: number;
  label: string; // "2026-W05"
  wili: number | null;
}

export interface FluSeries {
  state: string;
  label: string;
  points: FluPoint[];
  latest: number | null;
  previous: number | null;
  peak: number | null;
  level: FluLevel;
}

function epiweekLabel(epiweek: number): string {
  const year = Math.floor(epiweek / 100);
  const wk = epiweek % 100;
  return `${year}-W${String(wk).padStart(2, "0")}`;
}

// Walks back `weeks` MMWR weeks from today, handling the year boundary by
// stepping real dates rather than doing arithmetic on the packed integer
// (202601 - 5 is not a valid epiweek).
function epiweekRange(weeks: number): { start: number; end: number } {
  const now = new Date();
  const past = new Date(now.getTime() - weeks * 7 * 86400000);
  return { start: epiweekFor(past), end: epiweekFor(now) };
}

export async function fetchFluSeries(
  states: readonly string[] = TRACKED_STATES,
  weeks = 20
): Promise<FluSeries[]> {
  const regions = states
    .map((s) => STATE_TO_REGION[s.toUpperCase()])
    .filter(Boolean);
  if (regions.length === 0) return [];

  try {
    const { start, end } = epiweekRange(weeks);
    const url = `https://api.delphi.cmu.edu/epidata/fluview/?regions=${regions.join(
      ","
    )}&epiweeks=${start}-${end}`;

    const res = await fetch(url);
    if (!res.ok) return [];

    const data: { result: number; epidata?: (EpidataRow & { region: string })[] } =
      await res.json();
    if (data.result !== 1 || !data.epidata?.length) return [];

    return states
      .map((state) => {
        const region = STATE_TO_REGION[state.toUpperCase()];
        const rows = (data.epidata ?? [])
          .filter((r) => r.region === region)
          .sort((a, b) => a.epiweek - b.epiweek);

        const points: FluPoint[] = rows.map((r) => ({
          epiweek: r.epiweek,
          label: epiweekLabel(r.epiweek),
          wili: r.wili ?? r.ili ?? null,
        }));

        const values = points
          .map((p) => p.wili)
          .filter((v): v is number => v !== null);

        const latest = values.length ? values[values.length - 1] : null;
        const previous = values.length > 1 ? values[values.length - 2] : null;

        return {
          state: state.toUpperCase(),
          label: STATE_LABELS[state.toUpperCase()] ?? state,
          points,
          latest,
          previous,
          peak: values.length ? Math.max(...values) : null,
          level: latest === null ? ("unknown" as FluLevel) : classify(latest),
        };
      })
      .filter((s) => s.points.length > 0);
  } catch (err) {
    console.error(
      "[cdc-flu] series fetch failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return [];
  }
}

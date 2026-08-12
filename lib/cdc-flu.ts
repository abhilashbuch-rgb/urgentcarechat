// Client for CDC flu surveillance data via the free Delphi Epidata API
// (https://api.delphi.cmu.edu/epidata/fluview/), no key required at this
// volume. Used by /reads for a general flu-activity banner — fails soft,
// never throws, since this is decorative context, not triage-critical.

export type FluLevel = "low" | "moderate" | "high" | "unknown";

export interface FluActivity {
  level: FluLevel;
  weightedIli: number | null;
  epiweek: number | null;
  state: string;
}

// Delphi's region codes are NOT simply lowercased state abbreviations.
// New York reports as "ny_minus_jfk" (state excluding NYC, which reports
// separately); a plain "ny" is rejected with result:-2, which this code
// previously sent — so NY silently reported "unknown" forever.
const STATE_TO_REGION: Record<string, string> = {
  PA: "pa",
  NJ: "nj",
  NY: "ny_minus_jfk",
  DE: "de",
  MD: "md",
};

// Human labels, since "NY" here genuinely excludes New York City.
export const STATE_LABELS: Record<string, string> = {
  PA: "Pennsylvania",
  NJ: "New Jersey",
  NY: "New York (excl. NYC)",
  DE: "Delaware",
  MD: "Maryland",
};

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
  return { level: "unknown", weightedIli: null, epiweek: null, state };
}

export async function fetchFluActivity(stateAbbrev: string): Promise<FluActivity> {
  const region = STATE_TO_REGION[stateAbbrev.toUpperCase()];
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
      state: stateAbbrev,
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

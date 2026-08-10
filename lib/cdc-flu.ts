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

const STATE_TO_REGION: Record<string, string> = {
  PA: "pa",
  NJ: "nj",
  NY: "ny",
  DE: "de",
  MD: "md",
};

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

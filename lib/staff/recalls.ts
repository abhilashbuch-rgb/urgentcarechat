import type { StaffSql } from "@/lib/staff/db";

// FDA recalls, matched against what a clinic actually stocks — see
// supabase/staff-recall-alerts.sql.
//
// DELIBERATELY NARROW. Matched only against staff.inventory_items.name,
// the one place a clinic types a real, specific product name (a
// vaccine brand, a drug, a named supply). Equipment-calibration's
// categories ("Glucometer", "Autoclave", "Pulse oximeter") are generic
// on purpose — see supabase/staff-statutory-logs.sql — and matching a
// category name against a device-recall database would flag almost
// every recall in it against almost every clinic, which is exactly the
// kind of noise that trains people to stop reading these.
//
// SOURCE: openFDA's public enforcement endpoints (api.fda.gov), no key
// required at this volume. Two independent datasets — drug and device —
// fetched separately so one provider's outage never costs the other.

export type RecallSource = "fda_drug" | "fda_device";

export interface RecallRecord {
  source: RecallSource;
  recallNumber: string;
  classification: string | null;
  status: string;
  productDescription: string;
  reasonForRecall: string | null;
  recallingFirm: string | null;
  reportDate: string | null;
  /** Lowercased blob of every name openFDA gives for this recall —
   *  product description, firm, brand/generic/device/substance names —
   *  what an item's name is checked against. */
  searchText: string;
}

interface OpenFdaResult {
  recall_number?: string;
  classification?: string;
  status?: string;
  product_description?: string;
  reason_for_recall?: string;
  recalling_firm?: string;
  report_date?: string;
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    device_name?: string[];
    substance_name?: string[];
  };
}

function parseFdaDate(v: string | undefined): string | null {
  if (!v || v.length !== 8) return null;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

// Two pages, not one. openFDA returns "Ongoing" recalls newest-first;
// capping at one page of 100 risked a genuinely-still-ongoing older
// recall silently falling out of the window and reading as lifted the
// next time matchRecallsForOrg() clears anything not in this list.
// 200 is still a small, fast fetch and pushes that edge case out
// further without paginating indefinitely.
const PAGES = 2;
const PAGE_SIZE = 100;

async function fetchOne(source: RecallSource): Promise<RecallRecord[]> {
  const endpoint = source === "fda_drug" ? "drug" : "device";
  const out: RecallRecord[] = [];

  for (let page = 0; page < PAGES; page++) {
    const url =
      `https://api.fda.gov/${endpoint}/enforcement.json` +
      `?search=status:%22Ongoing%22&limit=${PAGE_SIZE}&skip=${page * PAGE_SIZE}` +
      `&sort=report_date:desc`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      // openFDA answers 404 for "no more results" — the normal way a
      // second page ends, not a failure. Anything else stops paging
      // for this source but keeps what was already fetched.
      if (res.status === 404) break;
      console.error(`[recalls] openFDA ${endpoint} page ${page}: ${res.status}`);
      break;
    }
    const body = (await res.json()) as { results?: OpenFdaResult[] };
    const results = body.results ?? [];
    if (results.length === 0) break;

    for (const r of results) {
      if (!r.recall_number) continue;
      const searchText = [
        r.product_description,
        r.recalling_firm,
        ...(r.openfda?.brand_name ?? []),
        ...(r.openfda?.generic_name ?? []),
        ...(r.openfda?.device_name ?? []),
        ...(r.openfda?.substance_name ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      out.push({
        source,
        recallNumber: r.recall_number,
        classification: r.classification ?? null,
        status: r.status ?? "Ongoing",
        productDescription: r.product_description ?? "Unnamed product",
        reasonForRecall: r.reason_for_recall ?? null,
        recallingFirm: r.recalling_firm ?? null,
        reportDate: parseFdaDate(r.report_date),
        searchText,
      });
    }
    if (results.length < PAGE_SIZE) break;
  }

  return out;
}

/** Both sources, independently — a device-API hiccup must not cost the
 *  drug recalls this run, and an empty result from one is never
 *  treated as "nothing is recalled," only as "this source didn't
 *  answer this time." */
export async function fetchOngoingRecalls(): Promise<{
  recalls: RecallRecord[];
  sourcesOk: RecallSource[];
}> {
  const [drugs, devices] = await Promise.allSettled([
    fetchOne("fda_drug"),
    fetchOne("fda_device"),
  ]);
  const recalls: RecallRecord[] = [];
  const sourcesOk: RecallSource[] = [];
  if (drugs.status === "fulfilled") {
    recalls.push(...drugs.value);
    sourcesOk.push("fda_drug");
  } else console.error("[recalls] drug fetch failed:", drugs.reason);
  if (devices.status === "fulfilled") {
    recalls.push(...devices.value);
    sourcesOk.push("fda_device");
  } else console.error("[recalls] device fetch failed:", devices.reason);
  return { recalls, sourcesOk };
}

export interface RecallMatchOutcome {
  matched: number;
  cleared: number;
}

/** Match one org's actually-stocked, active items against the recall
 *  list, and clear any previously-recorded alert whose recall is no
 *  longer in it — the same day FDA lifts one, this stops warning about
 *  it. Only clears alerts from a SOURCE that actually answered this
 *  run (sourcesOk) — a device-API outage must not look like every
 *  device recall was lifted. */
export async function matchRecallsForOrg(
  sql: StaffSql,
  org: string,
  recalls: RecallRecord[],
  sourcesOk: RecallSource[]
): Promise<RecallMatchOutcome> {
  const items = await sql<{ id: string; name: string }[]>`
    select id, name from staff.inventory_items
     where org_slug = ${org} and active and length(name) >= 4
  `;

  let matched = 0;
  for (const item of items) {
    const needle = item.name.toLowerCase();
    for (const r of recalls) {
      if (!r.searchText.includes(needle)) continue;
      const inserted = await sql<{ id: string }[]>`
        insert into staff.recall_alerts
          (org_slug, item_id, source, recall_number, classification, status,
           product_description, reason_for_recall, recalling_firm, report_date,
           detail_url)
        values
          (${org}, ${item.id}, ${r.source}, ${r.recallNumber}, ${r.classification},
           ${r.status}, ${r.productDescription}, ${r.reasonForRecall},
           ${r.recallingFirm}, ${r.reportDate}, ${detailUrl(r)})
        on conflict (org_slug, item_id, recall_number)
        do update set status = excluded.status, classification = excluded.classification
        returning id
      `;
      if (inserted.length > 0) matched += 1;
    }
  }

  let cleared = 0;
  if (sourcesOk.length > 0) {
    const stillOngoing = recalls.map((r) => r.recallNumber);
    const result = await sql<{ id: string }[]>`
      delete from staff.recall_alerts
       where org_slug = ${org}
         and source = any(${sql.array(sourcesOk)})
         and not (recall_number = any(${sql.array(stillOngoing.length > 0 ? stillOngoing : [""])}))
      returning id
    `;
    cleared = result.length;
  }

  return { matched, cleared };
}

/** The literal openFDA query that returns this one record — always
 *  correct, since it's built from the same call this data came from,
 *  rather than a guess at a public-facing FDA page URL this codebase
 *  cannot verify the shape of. Raw JSON, not pretty, but never wrong. */
function detailUrl(r: RecallRecord): string {
  const endpoint = r.source === "fda_drug" ? "drug" : "device";
  return (
    `https://api.fda.gov/${endpoint}/enforcement.json` +
    `?search=recall_number:%22${encodeURIComponent(r.recallNumber)}%22`
  );
}

export interface RecallAlert {
  id: string;
  itemName: string;
  source: RecallSource;
  classification: string | null;
  productDescription: string;
  reasonForRecall: string | null;
  recallingFirm: string | null;
  reportDate: string | null;
  detailUrl: string | null;
}

const SEVERITY_ORDER: Record<string, number> = { "Class I": 0, "Class II": 1, "Class III": 2 };

/** Every currently-active recall alert for this org, most severe and
 *  most recent first — for app/staff/page.tsx. Shown to everyone who
 *  sees that board; see this file's header for why. */
export async function activeRecallAlerts(sql: StaffSql, org: string): Promise<RecallAlert[]> {
  const rows = await sql<
    {
      id: string;
      item_name: string;
      source: RecallSource;
      classification: string | null;
      product_description: string;
      reason_for_recall: string | null;
      recalling_firm: string | null;
      report_date: string | null;
      detail_url: string | null;
    }[]
  >`
    select r.id, i.name as item_name, r.source, r.classification,
           r.product_description, r.reason_for_recall, r.recalling_firm,
           r.report_date::text as report_date, r.detail_url
      from staff.recall_alerts r
      join staff.inventory_items i on i.id = r.item_id
     where r.org_slug = ${org}
     order by r.report_date desc nulls last
  `;
  return rows
    .map((r) => ({
      id: r.id,
      itemName: r.item_name,
      source: r.source,
      classification: r.classification,
      productDescription: r.product_description,
      reasonForRecall: r.reason_for_recall,
      recallingFirm: r.recalling_firm,
      reportDate: r.report_date,
      detailUrl: r.detail_url,
    }))
    // Sorted here, not in SQL — the classification-order case
    // expression would have to be repeated at every call site that
    // wants this same "worst first" order, and there is exactly one.
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.classification ?? ""] ?? 3) -
        (SEVERITY_ORDER[b.classification ?? ""] ?? 3)
    );
}

export const CLASSIFICATION_EXPLANATION: Record<string, string> = {
  "Class I":
    "The most serious class — a reasonable probability that using this product will cause serious harm or death.",
  "Class II":
    "May cause temporary or reversible harm, or the chance of serious harm is remote.",
  "Class III":
    "Not likely to cause harm, but the product violates FDA labeling or manufacturing rules.",
};

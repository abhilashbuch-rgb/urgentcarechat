import { XMLParser } from "fast-xml-parser";

// Reads MedlinePlus's public "New Links" RSS feed — the real, official
// feed of content NLM has added recently (https://medlineplus.gov/rss.html).
//
// Deliberately NOT MedlinePlus Connect: Connect is a code-lookup service
// (send it an ICD-10 / SNOMED / RxNorm / LOINC / CPT code, get back
// patient-education links). It carries no news, statistics, or trend
// data, so it can't drive a feed or a chart.

const FEED_URL = "https://medlineplus.gov/groupfeeds/new.xml";

export interface NewsItem {
  title: string;
  url: string;
  source: string | null;        // e.g. "Medical Encyclopedia"
  relatedTopics: string[];      // e.g. ["Dislocated Shoulder"]
  publishedAt: string | null;   // ISO
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

// Each item's description is a small HTML blob shaped like:
//   <p>Source: Medical Encyclopedia<br/>Related MedlinePlus Pages:
//      <a href="...">Dislocated Shoulder</a></p>
// so source and topics are pulled out of it rather than guessed at.
function parseDescription(desc: string): {
  source: string | null;
  relatedTopics: string[];
} {
  const sourceMatch = desc.match(/Source:\s*([^<]+)/i);
  const source = sourceMatch ? sourceMatch[1].trim() : null;

  const relatedTopics = Array.from(
    desc.matchAll(/<a[^>]*>([^<]+)<\/a>/gi),
    (m) => m[1].trim()
  ).filter(Boolean);

  return { source, relatedTopics };
}

export async function fetchHealthNews(limit = 24): Promise<NewsItem[]> {
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) {
      console.error("[medlineplus-news] feed returned", res.status);
      return [];
    }

    const parsed = parser.parse(await res.text());
    const raw = parsed?.rss?.channel?.item;
    if (!raw) return [];

    const items = Array.isArray(raw) ? raw : [raw];

    return items.slice(0, limit).map((it): NewsItem => {
      const desc = text(it?.description);
      const { source, relatedTopics } = parseDescription(desc);
      const pub = text(it?.pubDate);
      const parsedDate = pub ? new Date(pub) : null;

      return {
        title: text(it?.title).trim(),
        url: text(it?.link).trim(),
        source,
        relatedTopics,
        publishedAt:
          parsedDate && !isNaN(parsedDate.getTime())
            ? parsedDate.toISOString()
            : null,
      };
    });
  } catch (err) {
    console.error(
      "[medlineplus-news] fetch failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return [];
  }
}

// Counts per source for the "where new content came from" bar chart —
// a magnitude-by-category measure, so it gets one sequential hue rather
// than a categorical palette.
export function countBySource(items: NewsItem[]): { source: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const key = it.source || "Other";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

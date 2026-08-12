import { XMLParser } from "fast-xml-parser";

// Client for the free, no-key-required NLM MedlinePlus Health Topics Web
// Service (https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=...).
// Used by /reads for general, non-personalized health reading material —
// deliberately separate from the triage chat.

export interface HealthTopic {
  title: string;
  summary: string;
  url: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

// Strips the highlighting <span> tags and any other HTML markup the
// service embeds in title/summary fields, decoding to plain text.
function stripHtml(value: string): string {
  return value
    // Closing block tags become a space, or sentences run together —
    // MedlinePlus summaries lead with an <h3> question, which produced
    // "What is the common cold?The common cold is..." without this.
    // Inline tags (span, b, em) are dropped with no space so the
    // highlight markup in titles doesn't split words.
    // Both OPENING and closing block tags, because MedlinePlus runs the
    // lead-in question straight into the body with an opening tag and no
    // close: "What is the common cold?<p>The common cold is..."
    .replace(/<\/?(p|li|ul|ol|h[1-6]|div|section|tr|td|blockquote)\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface ContentNode {
  "@_name"?: string;
  "#text"?: unknown;
}

interface DocumentNode {
  "@_url"?: string;
  content?: ContentNode | ContentNode[];
}

export async function fetchHealthTopic(term: string): Promise<HealthTopic | null> {
  const url = `https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=${encodeURIComponent(
    term
  )}&retmax=1`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const xml = await res.text();
  const parsed = parser.parse(xml);

  const list = parsed?.nlmSearchResult?.list;
  if (!list?.document) return null;

  const doc: DocumentNode = Array.isArray(list.document) ? list.document[0] : list.document;
  const contents = Array.isArray(doc.content) ? doc.content : doc.content ? [doc.content] : [];

  const titleNode = contents.find((c) => c["@_name"] === "title");
  const summaryNode = contents.find((c) => c["@_name"] === "FullSummary");
  const docUrl = doc["@_url"];

  if (!titleNode?.["#text"] || !summaryNode?.["#text"] || !docUrl) return null;

  return {
    title: stripHtml(String(titleNode["#text"])),
    summary: stripHtml(String(summaryNode["#text"])),
    url: docUrl,
  };
}

// Curated, non-alarming, common topics — deliberately everyday stuff,
// not rare/scary conditions, since this page is general reading material.
export const HEALTH_TOPIC_TERMS = [
  "common cold",
  "seasonal flu",
  "dehydration",
  "sprains and strains",
  "healthy sleep",
  "food poisoning",
  "allergies",
  "minor burns",
  "stress management",
  "vaccines",
  "handwashing",
  "nutrition basics",
  "exercise",
  "sunburn prevention",
  "ear infections",
  "sinusitis",
  "back pain",
  "headaches",
  "urinary tract infections",
  "staying hydrated",
] as const;

// Deterministic daily rotation — no database needed. Picks `count`
// distinct terms from HEALTH_TOPIC_TERMS, seeded by today's date (UTC),
// so it's the same for everyone on a given day and rotates the next.
export function getTodaysTopics(count = 5): string[] {
  const today = new Date();
  const seed =
    today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate();

  const pool = [...HEALTH_TOPIC_TERMS];
  const picked: string[] = [];
  let state = seed;

  while (picked.length < Math.min(count, pool.length)) {
    // Simple LCG for a deterministic, evenly-distributed pseudo-random index.
    state = (state * 1103515245 + 12345) % 2147483648;
    const index = state % pool.length;
    picked.push(pool.splice(index, 1)[0]);
  }

  return picked;
}

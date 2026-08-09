import { NextResponse } from "next/server";
import { fetchHealthTopic, getTodaysTopics, type HealthTopic } from "@/lib/medlineplus";

// GET /api/health-reads — today's rotating set of general health topics.
// Uses Promise.allSettled so one failed MedlinePlus lookup doesn't take
// down the rest of the page.
export async function GET() {
  const terms = getTodaysTopics(5);
  const results = await Promise.allSettled(terms.map((term) => fetchHealthTopic(term)));

  const reads: HealthTopic[] = results
    .filter(
      (r): r is PromiseFulfilledResult<HealthTopic | null> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value as HealthTopic);

  return NextResponse.json({ reads });
}

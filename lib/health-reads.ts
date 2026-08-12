import { fetchHealthTopic, getTodaysTopics, type HealthTopic } from "@/lib/medlineplus";

// Shared by /reads (full list) and the homepage preview, so both show the
// same rotation on a given day and there's only one place this fetch
// logic lives. Promise.allSettled means one failed MedlinePlus lookup
// degrades the list instead of taking the page down.
export async function getTodaysReads(count = 5): Promise<HealthTopic[]> {
  const terms = getTodaysTopics(count);
  const results = await Promise.allSettled(terms.map((term) => fetchHealthTopic(term)));
  return results
    .filter(
      (r): r is PromiseFulfilledResult<HealthTopic | null> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value as HealthTopic);
}

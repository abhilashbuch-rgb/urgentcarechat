import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import { type HealthTopic } from "@/lib/medlineplus";
import { getTodaysReads } from "@/lib/health-reads";
import FluBanner from "@/app/components/FluBanner";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata = {
  title: `Health Reads — ${PRODUCT_NAME}`,
  description:
    "General, plain-language health reading — not personalized medical advice.",
};

// Refresh hourly — the topic set only changes once a day, but this keeps
// flu-activity data reasonably current without hitting the APIs on every request.
export const revalidate = 3600;

export default async function ReadsPage() {
  let reads: HealthTopic[] = [];

  try {
    reads = await getTodaysReads(5);
  } catch {
    // Graceful empty state below — reads stays [].
  }

  return (
    <div className="reads-page">
      <header className="site-header">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          <BrandLockup />
        </Link>
      </header>

      <main className="reads-main">
        <Link href="/" className="reads-back">
          ← Back to {PRODUCT_NAME}
        </Link>

        <h1 className="reads-title">Health Reads</h1>
        <p className="reads-sub">
          General health reading, in plain language — not personalized
          medical advice. If you&apos;re trying to figure out what to do
          about your own symptoms, use the{" "}
          <Link href="/">triage chat</Link> instead.
        </p>

        <p className="reads-sub">
          Want the numbers behind this?{" "}
          <Link href="/monitor">Open the Health Monitor</Link> for regional flu
          trends and everything MedlinePlus published this week.
        </p>

        <FluBanner />

        {reads.length > 0 ? (
          <div className="reads-grid">
            {reads.map((topic) => (
              <article className="read-card" key={topic.url}>
                <h2>{topic.title}</h2>
                <p>{topic.summary}</p>
                <a href={topic.url} target="_blank" rel="noopener noreferrer">
                  Read more on MedlinePlus →
                </a>
              </article>
            ))}
          </div>
        ) : (
          <p className="reads-empty">
            Couldn&apos;t load today&apos;s health reads right now — please
            check back later.
          </p>
        )}
      </main>
    </div>
  );
}

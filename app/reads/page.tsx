import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";
import { type HealthTopic } from "@/lib/medlineplus";
import { getTodaysReads } from "@/lib/health-reads";
import { fetchFluActivity, type FluActivity } from "@/lib/cdc-flu";

export const metadata = {
  title: "Health Reads — urgentcare.chat",
  description:
    "General, plain-language health reading — not personalized medical advice.",
};

// Refresh hourly — the topic set only changes once a day, but this keeps
// flu-activity data reasonably current without hitting the APIs on every request.
export const revalidate = 3600;

export default async function ReadsPage() {
  let reads: HealthTopic[] = [];
  let flu: FluActivity = { level: "unknown", weightedIli: null, epiweek: null, state: "PA" };

  try {
    [reads, flu] = await Promise.all([getTodaysReads(5), fetchFluActivity("PA")]);
  } catch {
    // Graceful empty state below — reads stays [] and flu stays "unknown".
  }

  return (
    <div className="reads-page">
      <header className="site-header">
        <div className="brand">
          <BrandIcon />
          urgentcare<span className="tld">.chat</span>
        </div>
      </header>

      <main className="reads-main">
        <Link href="/" className="reads-back">
          ← Back to urgentcare.chat
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

        {flu.level !== "unknown" && (
          <div className={`flu-banner flu-${flu.level}`}>
            <strong>
              Flu activity in {flu.state}: {flu.level}
            </strong>
            {flu.weightedIli !== null && (
              <span className="flu-detail">
                {" "}
                · {flu.weightedIli.toFixed(1)}% weighted ILI (CDC FluView)
              </span>
            )}
          </div>
        )}

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

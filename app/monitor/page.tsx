import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";
import HealthMonitor from "@/app/components/HealthMonitor";
import { getTodaysReads } from "@/lib/health-reads";
import { fetchFluSeries, type FluSeries } from "@/lib/cdc-flu";
import { fetchHealthNews, countBySource, type NewsItem } from "@/lib/medlineplus-news";
import { type HealthTopic } from "@/lib/medlineplus";

export const metadata = {
  title: "Health Monitor — urgentcare.chat",
  description:
    "Live regional flu activity from CDC FluView, plus health topics and new content from the National Library of Medicine.",
};

// Hourly ISR — the underlying data moves weekly (FluView) and daily
// (topics), so re-fetching per visitor would be waste.
export const revalidate = 3600;

export default async function MonitorPage() {
  let series: FluSeries[] = [];
  let topics: HealthTopic[] = [];
  let news: NewsItem[] = [];

  // Settled individually: a MedlinePlus outage shouldn't blank the chart,
  // and a Delphi outage shouldn't blank the news.
  const [seriesRes, topicsRes, newsRes] = await Promise.allSettled([
    fetchFluSeries(),
    getTodaysReads(4),
    fetchHealthNews(24),
  ]);

  if (seriesRes.status === "fulfilled") series = seriesRes.value;
  if (topicsRes.status === "fulfilled") topics = topicsRes.value;
  if (newsRes.status === "fulfilled") news = newsRes.value;

  const sources = countBySource(news);
  const hasAnything = series.length > 0 || topics.length > 0 || news.length > 0;

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/" style={{ textDecoration: "none" }}>
            <BrandIcon />
            <span>
              urgentcare<span className="lp-tld">.chat</span>
            </span>
          </Link>
          <nav className="lp-nav-links">
            <Link href="/reads">Health Reads</Link>
            <Link href="/">Find care</Link>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        <section className="mon-head">
          <span className="lp-eyebrow">
            <span className="lp-eyebrow-dot" aria-hidden="true" />
            Live public-health data
          </span>
          <h1 className="lp-h1 mon-h1">Health Monitor</h1>
          <p className="lp-lede">
            Regional flu activity straight from CDC FluView, alongside health
            topics and newly published material from the National Library of
            Medicine. General information about your area — not a read on your
            own health. For symptoms, <Link href="/">use the chat</Link>.
          </p>
        </section>

        {hasAnything ? (
          <HealthMonitor
            series={series}
            topics={topics}
            news={news}
            sources={sources}
          />
        ) : (
          <section className="mon-panel">
            <p className="lp-section-sub">
              Live data isn&apos;t reachable right now. This page pulls from
              CDC FluView and the National Library of Medicine directly, so
              this usually clears on its own — try again shortly.
            </p>
          </section>
        )}

        <section className="mon-panel mon-notes">
          <h2 className="mon-panel-title">About this data</h2>
          <ul className="sec-list">
            <li>
              <strong>Flu activity</strong> is weighted influenza-like-illness
              (wILI) — the share of outpatient visits for ILI, as reported to
              CDC FluView and served by the Carnegie Mellon Delphi Epidata API.
              Low is under 2%, moderate under 4%, high at or above 4%.
            </li>
            <li>
              <strong>New York excludes New York City,</strong> which reports to
              FluView as its own region. That&apos;s CDC&apos;s split, not ours.
            </li>
            <li>
              <strong>Recent weeks get revised.</strong> FluView data is
              provisional and restated as more providers report, so the latest
              point can move.
            </li>
            <li>
              <strong>Topics and new links</strong> come from MedlinePlus, the
              NLM&apos;s consumer health service. Nothing here is personalized
              or a diagnosis.
            </li>
          </ul>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-footer-brand">
            urgentcare.chat &mdash; a Medicin.io LLC product
          </span>
          <span className="lp-footer-links">
            <Link href="/">Home</Link>
            <Link href="/reads">Health Reads</Link>
            <Link href="/security">Security</Link>
            <Link href="/privacy">Privacy</Link>
          </span>
        </div>
        <p className="lp-footer-note">
          Not a diagnosis tool and not a substitute for emergency care. If you
          are having a medical emergency, call 911.
        </p>
      </footer>
    </div>
  );
}

import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getClinicAnalytics, type ClickSummary } from "@/lib/clinic-analytics";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata = {
  title: `Referral analytics — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

// Always fresh — this is live referral data for whoever holds the link.
export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  directions: "Directions clicks",
  call: "Call clicks",
  website: "Website clicks",
};

function SummaryCard({ title, summary }: { title: string; summary: ClickSummary }) {
  const maxDaily = Math.max(1, ...summary.dailyCounts.map((d) => d.count));

  return (
    <div className="analytics-card">
      <h2>{title}</h2>
      <div className="analytics-total">{summary.total}</div>
      <div className="analytics-total-label">total clicks, last 30 days</div>

      <div className="analytics-by-type">
        {Object.entries(EVENT_LABELS).map(([key, label]) => (
          <div className="analytics-type-row" key={key}>
            <span>{label}</span>
            <strong>{summary.byType[key] || 0}</strong>
          </div>
        ))}
      </div>

      {summary.dailyCounts.length > 0 && (
        <div className="analytics-sparkline" aria-hidden="true">
          {summary.dailyCounts.map((d) => (
            <div
              key={d.date}
              className="analytics-bar"
              style={{ height: `${(d.count / maxDaily) * 100}%` }}
              title={`${d.date}: ${d.count}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default async function ClinicAnalyticsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const analytics = await getClinicAnalytics(token);

  if (!analytics) notFound();

  const { clinic, location, network } = analytics;

  return (
    <div className="analytics-page">
      <header className="site-header">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          <BrandLockup />
        </Link>
      </header>

      <main className="analytics-main">
        <p className="analytics-eyebrow">Referral analytics · private link</p>
        <h1 className="analytics-title">{clinic.name}</h1>
        {clinic.isFeatured && (
          <p className="analytics-featured-note">
            This location is a featured listing
            {network ? " — its network is boosted in search results too." : "."}
          </p>
        )}

        <div className="analytics-grid">
          <SummaryCard title="This location" summary={location} />
          {network && (
            <SummaryCard
              title={`${clinic.brand} network (${network.locationCount} locations)`}
              summary={network}
            />
          )}
        </div>

        {location.total === 0 && (
          <p className="reads-empty">
            No referrals logged yet for this location in the last 30 days —
            check back after medicin.io sends some traffic your way.
          </p>
        )}

        <p className="legal-links">
          <Link href={`/clinics/wait/${clinic.waitToken}`}>
            Update your current wait time
          </Link>
          {" · "}
          <Link href="/">Back to medicin.io</Link>
        </p>
      </main>
    </div>
  );
}

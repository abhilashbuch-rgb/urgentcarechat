import type { Metadata } from "next";
import DemoBanner from "@/app/components/demo/DemoBanner";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Demo: my documents — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<string, string> = {
  expired: "Expired",
  expiring: "Expiring",
  current: "Current",
};

const FIXTURES = [
  { id: "1", title: "BLS/CPR — American Heart Association", type: "BLS / CPR", status: "current", expires: "Mar 14, 2027" },
  { id: "2", title: "RN licence — Pennsylvania", type: "Licence", status: "expiring", expires: "Sep 30, 2026" },
  { id: "3", title: "ACLS — American Heart Association", type: "ACLS", status: "current", expires: "Jan 8, 2027" },
  { id: "4", title: "Bloodborne pathogens — annual CME", type: "CME", status: "expired", expires: "Jul 1, 2026" },
] as const;

export default function DemoDocuments() {
  const expired = FIXTURES.filter((d) => d.status === "expired").length;
  const expiring = FIXTURES.filter((d) => d.status === "expiring").length;

  return (
    <div className="st-page st-page-narrow">
      <DemoBanner role="any staff member" />
      <header className="st-page-head">
        <h1 className="st-h1">My documents</h1>
        <p className="st-page-sub">
          {expired > 0
            ? `${expired} expired, ${expiring} expiring soon.`
            : "Everything current."}
        </p>
      </header>

      <div className="st-doc-shelf">
        {FIXTURES.map((d) => (
          <article key={d.id} className={`st-shelf-item st-shelf-${d.status}`}>
            <div className="st-shelf-main">
              <p className="st-shelf-title">{d.title}</p>
              <p className="st-shelf-type">{d.type}</p>
            </div>
            <div className="st-shelf-meta">
              <span className={`st-tag st-tag-${d.status}`}>{STATUS_LABELS[d.status]}</span>
              <span className="st-shelf-date">Expires {d.expires}</span>
              <span className="st-shelf-verify">Kept by the person it belongs to</span>
            </div>
          </article>
        ))}
      </div>

      <p className="st-log-help">
        On the real screen, adding one is a date (required) and a photo of
        the card (optional) &mdash; the upload button is disabled here since
        this demo has nowhere to store a file.
      </p>
    </div>
  );
}

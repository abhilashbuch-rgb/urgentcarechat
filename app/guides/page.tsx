import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import { PRODUCT_NAME, contactMailto } from "@/lib/site";

export const metadata = {
  title: `Compliance guides for urgent care — ${PRODUCT_NAME}`,
  description:
    "Plain-language guides to the federal rules urgent care and med spa staff actually get asked about — sharps injury logs, hazardous chemical inventories, and CLIA-waived testing — sourced from the regulation, not a manual.",
};

// One page per rule, cited to the regulation itself rather than to an
// accreditor's manual — see supabase/staff-statutory-logs.sql, which
// explains why: the underlying duty is public law, and the manual's own
// wording, ordering and checklists are the publisher's copyright even
// where the duty behind them isn't. These guides carry the same content
// this product actually tracks — a reader who came here searching a
// citation is the same person /start is built for.
const GUIDES = [
  {
    slug: "osha-sharps-injury-log",
    eyebrow: "29 CFR 1910.1030(h)(5)",
    title: "The OSHA sharps injury log, explained",
    dek: "What the log has to record, what it can't include, and why it exists even at a clinic that's never had an injury.",
  },
  {
    slug: "hazardous-chemical-inventory-osha",
    eyebrow: "29 CFR 1910.1200",
    title: "Hazardous chemical inventory & SDS access",
    dek: "The chemical list and the safety data sheets behind it — what \"readily accessible\" actually means, and the one check a surveyor runs first.",
  },
  {
    slug: "clia-waived-testing-requirements",
    eyebrow: "42 CFR 493.15(e)(1)",
    title: "CLIA-waived testing: what the rule actually requires",
    dek: "The federal requirement is one sentence. Here's what it says, what it doesn't, and where the rest of what you've heard actually comes from.",
  },
] as const;

export default function GuidesIndexPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/" style={{ textDecoration: "none" }}>
            <BrandLockup />
          </Link>
          <nav className="lp-nav-links">
            <Link href="/demo">See a live demo</Link>
            <a href="/start" className="lp-nav-install">
              Install now
            </a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        <section className="guide-head">
          <span className="lp-eyebrow">
            <span className="lp-eyebrow-dot" aria-hidden="true" />
            Compliance guides
          </span>
          <h1 className="lp-h1 guide-h1">
            The rules urgent care staff actually get asked about.
          </h1>
          <p className="lp-lede">
            Sourced from the Code of Federal Regulations, not from an
            accreditation manual — each guide cites the actual rule, so
            you can check it yourself rather than take our word for it.
          </p>
        </section>

        <section className="guide-index-grid">
          {GUIDES.map((g) => (
            <Link key={g.slug} className="guide-card" href={`/guides/${g.slug}`}>
              <span className="guide-card-eyebrow">{g.eyebrow}</span>
              <h2>{g.title}</h2>
              <p>{g.dek}</p>
            </Link>
          ))}
        </section>

        <section className="guide-close">
          <h2 className="guide-h2">This is what the product tracks</h2>
          <p>
            Every log in this series is one {PRODUCT_NAME}{" "}already runs — filed
            on a phone, timestamped, and impossible to backdate. If you&apos;re
            reading this because a surveyor is coming, that&apos;s the fastest
            way to be ready for the next one too.
          </p>
          <Link className="lp-btn-primary" href="/start">
            Start the 30-day trial
          </Link>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-footer-brand">
            {PRODUCT_NAME}{" "}&mdash; a Medicin.io LLC product
          </span>
          <span className="lp-footer-links">
            <Link href="/">Home</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <a href={contactMailto("Question about a guide")}>Contact</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

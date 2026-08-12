import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";
import TriageApp from "@/app/components/TriageApp";
import { getTodaysReads } from "@/lib/health-reads";
import FluBanner from "@/app/components/FluBanner";
import { type HealthTopic } from "@/lib/medlineplus";

const KOFI_URL = "https://ko-fi.com/urgentcarechat";

// Case studies are a list from the start, even though AFC is the only one
// today — adding the next brand should be one entry here, not a rewrite.
const CASE_STUDIES = [
  {
    brand: "AFC Urgent Care",
    url: "https://afc.urgentcare.chat",
    host: "afc.urgentcare.chat",
    blurb:
      "Four Philadelphia-area locations, routed by their own branded assistant.",
    accent: "#E61D30",
  },
];

// Hourly ISR: the topic set rotates once a day and flu data weekly, so
// there's no reason to hit MedlinePlus and the CDC on every visit. The
// chat itself is a client component and stays fully live regardless.
export const revalidate = 3600;

// Root urgentcare.chat: the brand-agnostic public tool. The chat here is
// deliberately UNSCOPED — no tenant prop, so /api/clinics takes the
// public Google Places path and returns whatever is genuinely nearest,
// competitors included. Tenant scoping only ever comes from the
// x-tenant-slug header proxy.ts sets for a recognised subdomain, which
// the root domain never receives.
export default async function LandingPage() {
  let reads: HealthTopic[] = [];

  try {
    reads = await getTodaysReads(3);
  } catch {
    // Preview is optional chrome — an outage here must not take the
    // homepage (and the chat) down with it.
  }

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-brand">
            <BrandIcon />
            <span>
              urgentcare<span className="lp-tld">.chat</span>
            </span>
          </div>
          <nav className="lp-nav-links">
            <a href="#reads">Health Reads</a>
            <Link href="/monitor">Health Monitor</Link>
            <a href="#for-clinics">For clinics</a>
            <a
              className="lp-nav-cta"
              href="mailto:urgentcarechat@icloud.com?subject=Branded%20portal%20inquiry"
            >
              Book a walkthrough
            </a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        {/* ---------- 1. the tool itself, unscoped ---------- */}
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-eyebrow-dot" aria-hidden="true" />
              Free &middot; no signup &middot; 24/7
            </span>
            <h1 className="lp-h1">
              Describe what&apos;s wrong. Get sent to the right place.
            </h1>
            <p className="lp-lede">
              Tell it what&apos;s going on in plain language. It screens for
              real emergencies first, then finds the nearest urgent care that
              can actually help — with live wait times where clinics report
              them.
            </p>
            <ul className="lp-hero-points">
              <li>Nearest first, wherever you are in the US</li>
              <li>Emergencies routed straight to 911 or 988</li>
              <li>Nothing about you is stored</li>
            </ul>
            <p className="lp-hero-note">
              Not a doctor and not a diagnosis. If this is an emergency, call
              911.
            </p>
          </div>

          <div className="lp-hero-visual">
            <div className="lp-chat-card">
              <TriageApp contained />
            </div>
          </div>
        </section>

        {/* ---------- 2. Health Reads preview ---------- */}
        <section className="lp-section" id="reads">
          <div className="lp-section-head">
            <div>
              <h2 className="lp-section-title">Health Reads</h2>
              <p className="lp-section-sub">
                Plain-language health topics from the National Library of
                Medicine, rotating daily. General reading — not advice about
                your situation.
              </p>
            </div>
            <Link className="lp-section-link" href="/reads">
              See all &rarr;
            </Link>
          </div>

          <FluBanner />

          {reads.length > 0 ? (
            <div className="lp-reads-grid">
              {reads.map((topic) => (
                <article className="lp-tile lp-read-card" key={topic.url}>
                  <h3>{topic.title}</h3>
                  <p>{topic.summary}</p>
                  <p className="lp-tile-link">
                    <a href={topic.url} target="_blank" rel="noopener noreferrer">
                      Read on MedlinePlus &rarr;
                    </a>
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="lp-section-sub">
              Today&apos;s reads couldn&apos;t load right now —{" "}
              <Link href="/reads">try the full page</Link>.
            </p>
          )}
        </section>

        {/* ---------- 3. see it live ---------- */}
        <section className="lp-section" id="for-clinics">
          <div className="lp-section-head">
            <div>
              <h2 className="lp-section-title">See it live</h2>
              <p className="lp-section-sub">
                Urgent care groups run this on their own subdomain, with their
                logo and their brand color, routing only to their locations.
              </p>
            </div>
          </div>

          <ul className="lp-case-list">
            {CASE_STUDIES.map((c) => (
              <li className="lp-tile lp-case" key={c.host}>
                <span
                  className="lp-case-swatch"
                  style={{ background: c.accent }}
                  aria-hidden="true"
                />
                <div className="lp-case-body">
                  <h3>{c.brand}</h3>
                  <p>{c.blurb}</p>
                </div>
                <a
                  className="lp-btn-secondary lp-case-cta"
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {c.host} &rarr;
                </a>
              </li>
            ))}
          </ul>

          <div className="lp-case-footer">
            <p className="lp-section-sub">
              Want one of these under your own name? We&apos;ll stand up a
              working branded version with your real locations first.
            </p>
            <div className="lp-cta-row">
              <a
                className="lp-btn-primary"
                href="mailto:urgentcarechat@icloud.com?subject=Branded%20portal%20inquiry"
              >
                Book a walkthrough
              </a>
              <Link className="lp-btn-secondary" href="/security">
                Security &amp; compliance
              </Link>
            </div>
          </div>
        </section>

        {/* ---------- 4. trust strip ---------- */}
        <section className="lp-section lp-trust">
          <div className="lp-trust-points">
            <div>
              <h3>No ads.</h3>
              <p>Nothing on this site is an ad, and nothing ever will be.</p>
            </div>
            <div>
              <h3>No pay-for-placement.</h3>
              <p>
                Clinics can&apos;t buy their way to the top of your results.
                Ranking is distance and whether they&apos;re open.
              </p>
            </div>
            <div>
              <h3>Nearest, not sponsored.</h3>
              <p>
                If a competitor is closer to you, you see the competitor.
                That&apos;s the whole point.
              </p>
            </div>
          </div>
          <p className="lp-trust-kofi">
            Free to use and funded out of pocket. If it helped, you can{" "}
            <a href={KOFI_URL} target="_blank" rel="noopener noreferrer">
              buy us a coffee
            </a>
            .
          </p>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-footer-brand">
            urgentcare.chat &mdash; a Medicin.io LLC product
          </span>
          <span className="lp-footer-links">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/disclaimer">Disclaimer</Link>
            <Link href="/security">Security</Link>
            <Link href="/reads">Health Reads</Link>
            <Link href="/partners">White-label</Link>
          </span>
        </div>
        <p className="lp-footer-note">
          Not a diagnosis tool and not a substitute for emergency care. If you
          are having a medical emergency, call 911. For a mental health crisis,
          call or text 988.
        </p>
      </footer>
    </div>
  );
}

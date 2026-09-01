import BrandLockup from "@/app/components/BrandLockup";
import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/site";

// The medical-spa door.
//
// SAME PRODUCT, DIFFERENT OPENING LINE. Nothing on this page is a
// feature the homepage doesn't already have — it's the same logs,
// credentials and obligations register, described in the vocabulary a
// med spa owner actually uses (product lot, collaborative agreement,
// laser operator) instead of urgent care's (narcotics count, crash
// cart). See app/page.tsx for the reasoning behind what stays off both:
// no dollar figures, no promised feature that isn't built yet.
//
// EVERY CLAIM HERE IS SOMETHING THE PRODUCT ALREADY DOES. In
// particular: no accreditor is named as a partner or endorser on this
// page. That conversation is real and in progress, but a public claim
// of endorsement that gets ahead of where it actually stands is the
// kind of thing that costs the relationship the day someone checks it.

export const metadata: Metadata = {
  title: `Medical spa compliance — ${PRODUCT_NAME}`,
  description:
    "Compliance logging for medical spas: product lot and expiration tracking, laser safety checks, collaborative-agreement and injector-certification alerts, and an audit trail nobody can backdate.",
  alternates: { canonical: "/med-spa" },
};

const FEATURES: [string, string][] = [
  [
    "Every lot number, tracked to its expiration",
    "Botox, filler, and every other injectable logged by lot and expiry as it comes in and goes out — not a sticky note on the fridge door. An expired lot still in the drawer shows up before a patient does.",
  ],
  [
    "Laser safety, on the same phone as everything else",
    "Device checks and eyewash/autoclave verification done in seconds between clients, the same way a crash cart gets checked in urgent care — tapped through, not written on a clipboard that goes missing.",
  ],
  [
    "Your collaborative agreement and every injector's certification, watched",
    "Medical director oversight documents and each provider's laser or injector certification tracked with expiry alerts — the credential nobody notices lapsed until a surveyor asks for it.",
  ],
  [
    "Filed at the spa, and the record says so",
    "Every log carries a geolocation stamp — where it was entered, and how far that is from your address. One filed from home still saves, and arrives on your desk flagged with a written reason.",
  ],
  [
    "State-specific requirements, your own register",
    "Delegation review, adverse-event follow-up, whatever your state's medical board actually requires — add it to your obligations register with its own due date and owner, so it's tracked the same way as everything else instead of living in someone's memory.",
  ],
  [
    "Nothing can be backdated or deleted",
    "Signatures are insert-only at the database level, not by convention. There is no edit button, and no delete grant to take away.",
  ],
];

const INCLUDED = [
  "Product lot and expiration tracking for every injectable",
  "Laser safety and device checks, done in seconds on staff phones",
  "Collaborative-agreement and injector-certification expiry alerts",
  "Location stamped on every entry, with off-site filings flagged to you",
  "Unlimited staff accounts",
  "One-click surveyor view — no login, no billing, no patient information",
  "Read-only on lapse — your records are never held hostage",
];

export default function MedSpaPage() {
  return (
    <div className="lp lp-min">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/">
            <BrandLockup />
          </Link>
          <nav className="lp-nav-links">
            <a href="/demo">See a live demo</a>
            <a href="/staff/signin">Login</a>
            <a href="/start" className="lp-nav-install">
              Install now
            </a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        <section className="mh-hero mh-dark">
          <h1 className="mh-h1">
            Kill the paper binder.
            <br />
            <span className="mh-h1-accent">Pass every inspection.</span>
          </h1>
          <p className="mh-lede">
            Product lots, laser checks, and every injector&rsquo;s
            certification &mdash; done in seconds on your staff&rsquo;s
            phones, and impossible to backdate.
          </p>
          <div className="mh-cta-row">
            <Link className="mh-cta" href="/start">
              Start the 30-day trial
            </Link>
            <Link className="mh-cta-secondary" href="/demo">
              See a live demo
            </Link>
          </div>
          <span className="mh-cta-note">No credit card required</span>
        </section>

        <section className="mh-features">
          {FEATURES.map(([title, body]) => (
            <div className="mh-feature" key={title}>
              <h2>{title}</h2>
              <p>{body}</p>
            </div>
          ))}
        </section>

        <section className="mh-pricing" id="pricing">
          <h2 className="mh-h2">Simple, predictable pricing</h2>

          <div className="mh-plan">
            <p className="mh-plan-name">Single location</p>
            <p className="mh-plan-price">
              $149<span>/clinic/month</span>
            </p>
            <p className="mh-plan-annual">
              or $1,490 a year paid up front &mdash; two months free
            </p>
            <ul className="mh-plan-list">
              {INCLUDED.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Link className="mh-cta mh-cta-block" href="/start">
              Start free, then $149
            </Link>
          </div>

          <p className="mh-multi">
            Running more than one location?{" "}
            <Link href="/enterprise">Talk to us about enterprise terms</Link>.
          </p>
        </section>

        <section className="mh-install">
          <h2 className="mh-h2">Put it on the front-desk phone</h2>
          <p>
            Open this site on the spa&rsquo;s phone, tap <strong>Share</strong>,
            then <strong>Add to Home Screen</strong>. It opens full screen,
            straight to the day&rsquo;s logs &mdash; no browser, no search
            bar, no password typed between clients.
          </p>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-footer-brand">
            medicin.io &mdash; a Medicin.io LLC product
          </span>
          <span className="lp-footer-links">
            <Link href="/guides">Guides</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/security">Security</Link>
            <Link href="/contact">Contact</Link>
            <a href="/staff/signin">Staff sign-in</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

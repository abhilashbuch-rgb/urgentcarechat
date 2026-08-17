import type { Metadata } from "next";
import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";
import { contactMailto, PRODUCT_NAME } from "@/lib/site";
import Wordmark from "@/app/components/Wordmark";

// The homepage sells one thing in three seconds: pass inspections without
// a paper binder. Everything that was here before — feature paragraphs, a
// live chat demo, case studies, trust strips — was competing with that.
//
// NO DOLLAR FIGURES. The argument for buying this is that a failed
// inspection costs more than a year of it, and that argument works
// without a fine amount or a spoilage number attached. Specific figures
// on a public page are claims we would be making, they vary enormously by
// state and finding, and the first prospect who checks one and finds it
// wrong stops believing the rest of the page.

const FEATURES = [
  ["15-second logs", "Staff tap through a shift check on the phone already in their pocket."],
  ["Range alarms", "An out-of-range reading is caught as it's typed and can't be filed without a fix."],
  ["Surveyor link", "One read-only link, time-limited, for the inspector's iPad."],
];

const INCLUDED = [
  "Every regulatory shift log, ready on day one",
  "Unlimited staff accounts",
  "Automatic range alarms and corrective-action capture",
  "One-click surveyor view",
  "Signatures that can't be edited or deleted",
  "Read-only on lapse — your records are never held hostage",
];

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — kill the paper binder`,
  description:
    "Digital compliance logs for urgent care. Crash cart, fridge temperatures and narcotics counts done in seconds on staff phones, with an audit trail nobody can backdate.",
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return (
    <div className="lp lp-min">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-brand">
            <BrandIcon />
            <Wordmark tldClass="lp-tld" />
          </div>
          <nav className="lp-nav-links">
            <a href="/staff/signin">Sign in</a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        <section className="mh-hero">
          <h1 className="mh-h1">
            Kill the paper binder.
            <br />
            Pass every inspection.
          </h1>
          <p className="mh-lede">
            Crash cart checks, fridge curves and narcotics counts, done in
            seconds on your staff&rsquo;s phones — and impossible to backdate.
          </p>
          <Link className="mh-cta" href="/start">
            Start the 14-day trial
          </Link>
          <p className="mh-cta-note">No credit card required</p>
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
              or $1,490 a year paid up front — two months free
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
            Three or more clinics? $99 per clinic per month.{" "}
            <a href={contactMailto("Multi-unit pricing")}>
              Talk to us
            </a>
            .
          </p>
        </section>

        <section className="mh-install">
          <h2 className="mh-h2">Put it on the home screen</h2>
          <p>
            Open this site on the clinic phone, tap <strong>Share</strong>, then{" "}
            <strong>Add to Home Screen</strong>. It opens full screen, straight
            to the day&rsquo;s logs — no browser, no search bar, no password
            typed at 7am.
          </p>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-footer-brand">
            medicin.io &mdash; a Medicin.io LLC product
          </span>
          <span className="lp-footer-links">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/security">Security</Link>
            <a href="/staff/signin">Staff sign-in</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

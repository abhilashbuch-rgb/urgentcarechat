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

// The homepage used to say "Sign in" and leave the reason to the
// imagination. These are the reasons, in the order an owner cares about
// them: can the record be trusted, does the work actually get done, and
// what happens when an inspector walks in.
//
// Each one is a thing the product does today, not a roadmap. The
// location line in particular is worded as what it IS — every log
// carries where it was filed from — and not as "logs cannot be filed
// off-site", because browser geolocation is defeatable and a marketing
// claim the product cannot keep is worse than no claim. See the header
// of supabase/staff-geofence.sql.
const FEATURES: [string, string][] = [
  [
    "Filed at the clinic, and the record says so",
    "Every log is stamped with where it was entered and how far that is from your address. One filed from home still saves \u2014 and arrives on your desk flagged, with the distance and a written reason.",
  ],
  [
    "15-second shift checks",
    "Fridge temps, crash cart, O2, narcotics counts \u2014 tapped through on the phone already in their pocket. Repeat readings are one-tap presets, not typing.",
  ],
  [
    "An alarming number can't be filed quietly",
    "Out-of-range is caught as it's entered and cannot be saved without a corrective action in writing. Excursions text you immediately; everything else is a digest at nine and five.",
  ],
  [
    "Nothing can be backdated or deleted",
    "Signatures are insert-only at the database level, not by convention. There is no edit button, and no delete grant to take away.",
  ],
  [
    "One link for the surveyor",
    "Time-limited, read-only, no login. They see logs, credential dates and open obligations \u2014 no billing, no patient information, and no way into your account.",
  ],
  [
    "The binder, exported",
    "Ninety days of temperature curves, staff currency and corrective actions as one bookmarked PDF, generated on demand.",
  ],
];

const INCLUDED = [
  "Every regulatory shift log, ready on day one",
  "Location stamped on every entry, with off-site filings flagged to you",
  "Unlimited staff accounts",
  "Automatic range alarms and corrective-action capture",
  "One-click surveyor view",
  "Signatures that can't be edited or deleted",
  "Read-only on lapse — your records are never held hostage",
];

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — kill the paper binder`,
  description:
    "Digital compliance logs for urgent care. Crash cart, fridge temperatures and narcotics counts done in seconds on staff phones — location stamped, range alarms enforced, and an audit trail nobody can backdate.",
  alternates: { canonical: "/" },
};

/** The trace, run the full width as a rule.
 *
 *  The same path as the mark, stretched — so the logo is not a badge
 *  sitting in a corner but a shape the page is built out of. This is the
 *  cheapest way to make an identity feel deliberate rather than applied.
 */
function PulseRule() {
  return (
    <svg
      className="mh-rule"
      viewBox="0 0 240 24"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* Two beats and a long lead-out, so it reads as a strip cut from
          something continuous rather than a repeating pattern. */}
      <path
        d="M0 14 H26 L38 4 L50 21 L62 4 L74 14 H132 L144 4 L156 21 L168 4 L180 14 H240"
        fill="none"
        stroke="var(--volt)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="lp lp-min">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-brand">
            <BrandIcon />
            <Wordmark />
          </div>
          <nav className="lp-nav-links">
            <a href="/demo">See a live demo</a>
            <a href="/staff/signin">Sign in</a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        {/* THE ONE DARK SECTION. A page that is entirely mid-tone has
            nothing to anchor it, which is what made this feel flat — not
            the logo. One near-black block with the trace running across
            it does more than any amount of gradient. */}
        <section className="mh-hero mh-dark">
          <PulseRule />
          <h1 className="mh-h1">
            Kill the paper binder.
            <br />
            <span className="mh-h1-accent">Pass every inspection.</span>
          </h1>
          <p className="mh-lede">
            Crash cart checks, fridge curves and narcotics counts, done in
            seconds on your staff&rsquo;s phones — and impossible to backdate.
          </p>
          <div className="mh-cta-row">
            <Link className="mh-cta" href="/start">
              Start the 14-day trial
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

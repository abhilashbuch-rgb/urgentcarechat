import BookmarkButton from "@/app/components/BookmarkButton";
import BrandLockup from "@/app/components/BrandLockup";
import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/site";

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
// location line says what it IS — every log carries a geolocation
// stamp — and stops there. It used to also explain what the feature is
// NOT (a hard geofence, since browser location is spoofable) directly
// on this page; that qualifier is true and belongs somewhere a customer
// actually reads it before relying on it — a signed agreement, not a
// homepage skimmed in three seconds. See the header of
// supabase/staff-geofence.sql for the fuller version of that argument.
const FEATURES: [string, string][] = [
  [
    "Filed at the clinic, and the record says so",
    "Every log carries a geolocation stamp \u2014 where it was entered, and how far that is from your address. One filed from home still saves \u2014 and arrives on your desk flagged, with the distance and a written reason.",
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
    "Digital compliance logs for urgent care, primary care, and med spa. Crash cart, fridge temperatures and narcotics counts done in seconds on staff phones — geolocation stamped, range alarms enforced, and an audit trail nobody can backdate.",
  alternates: { canonical: "/" },
};

/** The hero's right-hand side: the product itself, not a stock photo.
 *
 *  REPLACES A FLAT DARK PANEL AND A THIN TRACE LINE. Neither said
 *  anything a prospect couldn't already read in the headline. A
 *  floating card showing one real moment in the app — a reading, in
 *  range, signed and badge-verified — does the same job a hero photo
 *  usually does (make the page feel inhabited) while also being the
 *  first proof of the product a visitor sees, three seconds in.
 *
 *  THE BACKGROUND TEXTURE IS THE BRAND MARK, HUGE AND NEARLY
 *  INVISIBLE — the same stacked-sheets shape as app/components/
 *  BrandIcon.tsx, not the pulse-trace zigzag this replaced. That
 *  zigzag survived here as a leftover after the icon itself changed
 *  everywhere else; this was the one place it was still hiding.
 */
function HeroVisual() {
  return (
    <div className="mh-hero-visual" aria-hidden="true">
      <div className="mh-glow" />
      <svg className="mh-stack-texture" viewBox="0 0 48 48" fill="none">
        <rect x="9" y="28" width="27" height="7.4" rx="3.4" stroke="#1c3352" strokeWidth="1.4" opacity="0.6" />
        <rect x="11.5" y="20.4" width="25" height="7.4" rx="3.4" stroke="#1c3352" strokeWidth="1.4" opacity="0.8" />
        <rect x="14" y="12.8" width="23" height="7.4" rx="3.4" stroke="#1c3352" strokeWidth="1.4" />
        <circle cx="35.5" cy="33.7" r="8" fill="#0b1220" stroke="#1c3352" strokeWidth="1.4" />
        <path d="M32 33.7 L34.3 36 L38.6 30.5" stroke="#1c3352" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <div className="mh-device-back" />
      <div className="mh-device">
        <div className="mh-device-top">
          <span className="mh-device-label">Vaccine fridge</span>
          <span className="mh-device-slot">AM check</span>
        </div>
        <div className="mh-device-title">Current temperature</div>
        <div className="mh-device-sub">36&ndash;46 &deg;F acceptable range</div>
        <div className="mh-device-reading">
          <span className="mh-device-value">38.4&deg;F</span>
          <span className="mh-device-pill">In range</span>
        </div>
        <div className="mh-device-sig">
          <div className="mh-device-badge">
            <svg width="20" height="20" viewBox="0 0 48 48">
              <rect x="9" y="28" width="27" height="7.4" rx="3.4" fill="none" stroke="#22d3ee" strokeWidth="2.6" opacity="0.4" />
              <rect x="11.5" y="20.4" width="25" height="7.4" rx="3.4" fill="none" stroke="#22d3ee" strokeWidth="2.6" opacity="0.7" />
              <rect x="14" y="12.8" width="23" height="7.4" rx="3.4" fill="none" stroke="#22d3ee" strokeWidth="2.6" />
              <circle cx="35.5" cy="33.7" r="8" fill="#0b1220" stroke="#22d3ee" strokeWidth="1.9" />
              <path d="M32 33.7 L34.3 36 L38.6 30.5" fill="none" stroke="#22d3ee" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mh-device-sig-text">
            <div className="mh-device-name">Signed by Dana Whitfield</div>
            <div className="mh-device-meta">Today, 9:14 AM &middot; On-site</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="lp lp-min">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-brand">
            <BrandLockup />
          </div>
          <nav className="lp-nav-links">
            <a href="/demo">See a live demo</a>
            <a href="/staff/signin">Login</a>
            {/* SAME DESTINATION AS THE HERO CTA, REACHABLE WITHOUT
                SCROLLING. "Install now" rather than "Start the 30-day
                trial" here on purpose — the nav has room for four words,
                not seven, and a first-time visitor on a phone should not
                have to scroll past the hero to find the one button that
                actually starts something. Same /start destination, same
                no-card trial; this is wording, not a different funnel.
                Not "Install free": the trial is free, the product is
                not, and "free" on the one button that starts a paid
                relationship is a promise this page does not make
                anywhere else on purpose. */}
            <a href="/start" className="lp-nav-install">
              Install now
            </a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        {/* THE ONE DARK SECTION. A page that is entirely mid-tone has
            nothing to anchor it, which is what made this feel flat — not
            the logo. One near-black block with the trace running across
            it does more than any amount of gradient. */}
        <section className="mh-hero mh-dark">
          <div className="mh-hero-inner">
            <div className="mh-hero-copy">
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
                  Start the 30-day trial
                </Link>
                <Link className="mh-cta-secondary" href="/demo">
                  See a live demo
                </Link>
              </div>
              <span className="mh-cta-note">No credit card required</span>
            </div>
            <HeroVisual />
          </div>
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

          {/* ONE PRICE PER CLINIC, no volume discount. A second clinic is a
              second set of logs, alarms, reports and inspections — the work
              the product does does not get cheaper per site, and a
              published discount sets the ceiling for every later
              negotiation. Groups are handled by adding clinics, each at
              the same price. */}
          <p className="mh-multi">
            More than one clinic? Add them from inside the app — $149/month
            each, one login across all of them.
          </p>

          <p className="mh-multi">
            Hospital system or a large network?{" "}
            <Link href="/enterprise">Talk to us about enterprise terms</Link>.
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
          <p>
            No phone in hand? It runs the same in any desktop or laptop
            browser — bookmark it so it&rsquo;s one click away.
          </p>
          <BookmarkButton />
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

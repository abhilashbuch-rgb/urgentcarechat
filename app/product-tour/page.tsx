import Link from "next/link";
import Image from "next/image";
import BrandLockup from "@/app/components/BrandLockup";
import ProductTourCarousel from "@/app/components/ProductTourCarousel";
import { PRODUCT_NAME, OPERATOR } from "@/lib/site";

export const metadata = {
  title: `Product tour — ${PRODUCT_NAME}`,
  description: `What the app actually looks like — real screens, not mockups.`,
};

// Real screens, not mockups — and not screenshots of a real clinic's
// data either. Every image here comes from /demo, the same
// no-login, nothing-saved sandbox linked from the nav, so this page
// can show exactly what a clinic sees without showing anyone's actual
// compliance record. See app/components/demo/DemoBanner.tsx for why
// that sandbox exists in the first place.
//
// STILL IMAGES OF A REAL APP, NOT A DESIGNED SHOWCASE. No cropping for
// effect, no fabricated data dressed up nicer than the real thing looks
// — if the product changes, these go stale and need retaking, which is
// the correct failure mode for a page that claims to show the product.

interface Shot {
  src: string;
  alt: string;
  caption: string;
}

const SHOTS: Shot[] = [
  {
    src: "/tour/today-board.png",
    alt: "The shift board, showing four checks left and one credential expiring in 34 days",
    caption:
      "What a medical assistant opens at the start of a shift — what's left to do today, nothing more.",
  },
  {
    src: "/tour/log-check-fridge.png",
    alt: "Refrigerator temperature check, showing a 2-8°C acceptable range and one-tap presets",
    caption:
      "A fridge temperature check. One-tap presets for the reading you get every day; a fifth tap for the one you don't.",
  },
  {
    src: "/tour/log-check-crashcart.png",
    alt: "Crash cart and AED check, showing O2 cylinder PSI and two yes/no questions",
    caption:
      "Crash cart & AED — a different set of fields entirely, because it's a different piece of equipment.",
  },
  {
    src: "/tour/check-filed-confirmation.png",
    alt: "Confirmation that a refrigerator check was filed at 11:44 PM, with a note that corrections file a new record",
    caption:
      "Filed. Every entry is timestamped and signed the moment it's submitted — a correction later adds a new record, it never edits this one.",
  },
  {
    src: "/tour/documents.png",
    alt: "A staff member's own document shelf, showing current, expiring, and expired credentials",
    caption:
      "One person's own credential shelf — current, expiring, and expired, so nothing is discovered for the first time during a survey.",
  },
  {
    src: "/tour/learning.png",
    alt: "Emergency procedure reference for anaphylaxis and an unresponsive patient, fully expanded with no pagination",
    caption:
      "Emergency steps, all on one screen, no “Next” button — this is read during the emergency, not before it.",
  },
  {
    src: "/tour/surveyor.png",
    alt: "The read-only inspector view: today's logs, credential currency, and open obligations in one page",
    caption:
      "What a surveyor's link opens to. No login, no navigation into the rest of the app, nothing financial — just the record.",
  },
];

export default function ProductTourPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/" style={{ textDecoration: "none" }}>
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
        <section className="sec-head">
          <span className="lp-eyebrow">
            <span className="lp-eyebrow-dot" aria-hidden="true" />
            Product tour
          </span>
          <h1 className="lp-h1 sec-h1">What it actually looks like.</h1>
          <p className="lp-lede">
            Every image below is a real screen from the app, not a mockup —
            pulled straight from the same interactive demo linked in the nav.
            Click through it yourself at{" "}
            <Link href="/demo">the live demo</Link>, or scroll through the
            stills here first.
          </p>
        </section>

        <section className="sec-block">
          <h2 className="sec-h2">The quick look</h2>
          <p className="sec-intro">Cycles on its own — click a dot to jump ahead.</p>
          <ProductTourCarousel shots={SHOTS} />
        </section>

        <section className="sec-block">
          <h2 className="sec-h2">Every screen, one at a time</h2>
        </section>
        <section className="tour-gallery" style={{ paddingTop: 0 }}>
          {SHOTS.map((shot) => (
            <figure className="tour-shot" key={shot.src}>
              <Image
                src={shot.src}
                alt={shot.alt}
                width={2400}
                height={1800}
                sizes="(max-width: 800px) 100vw, 760px"
                priority
              />
              <figcaption>{shot.caption}</figcaption>
            </figure>
          ))}
        </section>

        <section className="sec-block sec-close">
          <h2 className="sec-h2">Want to click through it yourself?</h2>
          <p className="sec-intro">
            The demo behind these screenshots takes no login and saves
            nothing — try your own clinic&rsquo;s setup, or just look around.
          </p>
          <a className="lp-btn-primary" href="/demo">
            Open the live demo
          </a>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-footer-brand">
            {PRODUCT_NAME} &mdash; a {OPERATOR} product
          </span>
          <span className="lp-footer-links">
            <Link href="/">Home</Link>
            <Link href="/demo">Live demo</Link>
            <Link href="/guides">Guides</Link>
            <Link href="/security">Security</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

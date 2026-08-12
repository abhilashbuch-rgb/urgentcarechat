import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";
import ChatPreview from "@/app/components/ChatPreview";

// Root urgentcare.chat is the B2B pitch page — the live triage chat runs
// under branded tenant subdomains (see app/t/[tenant] and proxy.ts).
// Styled with its own `lp-` scoped palette: a calmer clinical
// blue/teal, distinct from the red/white/blue patient-facing chat,
// because this page is selling to operators rather than triaging anyone.
export default function LandingPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-brand">
            <BrandIcon />
            {/* One element, not a bare text node + span — otherwise the
                flex gap lands between "urgentcare" and ".chat". */}
            <span>
              urgentcare<span className="lp-tld">.chat</span>
            </span>
          </div>
          <nav className="lp-nav-links">
            <Link href="/reads">Health Reads</Link>
            <Link href="/partners">White-label</Link>
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
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-eyebrow-dot" aria-hidden="true" />
              For urgent care groups &amp; MSOs
            </span>
            <h1 className="lp-h1">
              Turn your location finder into a conversation.
            </h1>
            <p className="lp-lede">
              Patients describe what&apos;s wrong in plain language.
              urgentcare.chat screens for real emergencies first, then routes
              them to the right location in your network — with live wait
              times, under your own brand and domain.
            </p>
            <div className="lp-cta-row">
              <a
                className="lp-btn-primary"
                href="mailto:urgentcarechat@icloud.com?subject=Branded%20portal%20inquiry"
              >
                Book a walkthrough
              </a>
              <Link className="lp-btn-secondary" href="/partners">
                How white-labeling works
              </Link>
            </div>
            <p className="lp-hero-note">
              Free for patients. No signup, no app, no PHI collected.
            </p>
          </div>

          <div className="lp-hero-visual">
            <ChatPreview />
            <p className="cp-caption">
              <span className="cp-swatch" aria-hidden="true" />{" "}
              Shown in <strong>AFC Urgent Care&apos;s</strong> brand color, on
              their own subdomain. Yours would use your logo and your color.
            </p>
          </div>
        </section>

        <section className="lp-bento" aria-label="What the platform does">
          <article className="lp-tile lp-tile-wide lp-tile-safety">
            <div className="lp-tile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
            </div>
            <h2>Emergencies never get routed to a clinic.</h2>
            <p>
              Chest pain, stroke signs, pediatric fever thresholds, suicidal
              ideation — checked before anything else runs, on both the
              browser and the server independently, and sent straight to 911
              or 988. The clinic list never gets in the way of an emergency.
            </p>
          </article>

          <article className="lp-tile">
            <div className="lp-tile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3.5 2" />
              </svg>
            </div>
            <h2>Live wait times.</h2>
            <p>
              Staff update from their phone in one tap, or your queue system
              pushes it automatically. Anything older than two hours hides
              itself rather than showing a number that&apos;s wrong.
            </p>
          </article>

          <article className="lp-tile">
            <div className="lp-tile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="10" r="3" />
                <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
              </svg>
            </div>
            <h2>Your network wins the search.</h2>
            <p>
              When a competitor happens to sit a block closer, your locations
              still surface together as one network — so you stop leaking your
              own patients to the clinic across the street.
            </p>
          </article>

          <article className="lp-tile">
            <div className="lp-tile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </div>
            <h2>No PHI. By design.</h2>
            <p>
              No name, no date of birth, no insurance ID, no account. An
              anonymous session and a zip code is the entire data footprint —
              which keeps this out of HIPAA scope entirely.
            </p>
            <p className="lp-tile-link">
              <Link href="/security">Full security posture &rarr;</Link>
            </p>
          </article>

          <article className="lp-tile lp-tile-domain">
            <div className="lp-tile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" />
              </svg>
            </div>
            <h2>Your brand, not ours.</h2>
            <p>
              Your logo in the header, your brand color through the whole
              interface, your own subdomain. Patients never see our name — we
              set the color from your brand guide, down to the exact hex.
            </p>
            <div className="lp-domain-chip">
              <span className="lp-domain-scheme">https://</span>
              <span className="lp-domain-sub">yourbrand</span>
              <span className="lp-domain-rest">.urgentcare.chat</span>
            </div>
          </article>
        </section>

        <section className="lp-close">
          <h2>Want to see it running under your own brand?</h2>
          <p>
            We&apos;ll stand up a working branded version with your real
            locations so you can try it before committing to anything.
          </p>
          <a
            className="lp-btn-primary"
            href="mailto:urgentcarechat@icloud.com?subject=Branded%20portal%20inquiry"
          >
            urgentcarechat@icloud.com
          </a>
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

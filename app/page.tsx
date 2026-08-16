import type { Metadata } from "next";
import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";
import TriageApp from "@/app/components/TriageApp";
import { getTodaysReads } from "@/lib/health-reads";
import { type HealthTopic } from "@/lib/medlineplus";

const CONTACT =
  "mailto:urgentcarechat@icloud.com?subject=Compliance%20walkthrough";

// Case studies are a list from the start, even though AFC is the only one
// today — adding the next brand should be one entry here, not a rewrite.
const CASE_STUDIES = [
  {
    brand: "AFC Urgent Care",
    url: "https://afc.urgentcare.chat",
    host: "afc.urgentcare.chat",
    blurb:
      "Their own subdomain, their own red, their own locations — and their staff area behind it.",
    accent: "#E61D30",
  },
];

// What actually replaces the binder. Only forms that exist and ship
// seeded; nothing here is a roadmap item dressed up as a feature.
const LOGS = [
  ["Crash cart & AED", "Daily", "Seal number, self-test, O2 pressures, suction"],
  ["Refrigerator temperatures", "Twice daily", "Current, 24-hour min and max, 36–46 °F"],
  ["Controlled substance count", "Per shift", "Physical count, witness, discrepancy"],
  ["Eyewash & autoclave", "Weekly", "ANSI Z358.1 flush, spore test result"],
  ["Point-of-care QC", "Per lot", "Controls for each CLIA-waived assay"],
  ["Lead apron inspection", "Quarterly", "Visual and tactile integrity, disposition"],
  ["Quality improvement review", "Quarterly", "Chart audit, over-read concordance"],
];

export const metadata: Metadata = {
  title: "urgentcare.chat — compliance software for urgent care",
  description:
    "Replace the paper compliance binder. Daily logs signed and time-stamped, staff onboarding with real signatures, and an audit trail nobody can edit after the fact.",
  alternates: { canonical: "/" },
};

// Hourly ISR: the Health Reads topic set rotates once a day, so there's no
// reason to hit MedlinePlus on every visit. The chat further down is a
// client component and stays fully live regardless.
export const revalidate = 3600;

// Root urgentcare.chat. This page now sells the compliance engine to the
// people who run clinics; the patient triage tool is a section on it
// rather than the headline.
//
// The chat below is deliberately UNSCOPED — no tenant prop, so
// /api/clinics takes the public Google Places path and returns whatever is
// genuinely nearest, competitors included. Tenant scoping only ever comes
// from the x-tenant-slug header proxy.ts sets for a recognised subdomain,
// which the root domain never receives.
export default async function LandingPage() {
  let reads: HealthTopic[] = [];
  try {
    reads = await getTodaysReads(3);
  } catch {
    // Optional chrome — an outage here must not take the homepage down.
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
            <a href="#logs">Logs</a>
            <a href="#onboarding">Onboarding</a>
            <a href="#security">Security</a>
            <a href="#triage">Patient triage</a>
            <a className="lp-nav-cta" href={CONTACT}>
              Book a walkthrough
            </a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        {/* ---------- hero ---------- */}
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-eyebrow-dot" aria-hidden="true" />
              For urgent care operators
            </span>
            <h1 className="lp-h1">
              The binder is the liability. Not the missing log.
            </h1>
            <p className="lp-lede">
              A surveyor doesn&rsquo;t find gaps because your clinic is
              careless. They find them because a paper binder can be filled in
              on Friday for a week that already happened, and everyone knows
              it. This can&rsquo;t be.
            </p>
            <ul className="lp-hero-points">
              <li>Every entry stamped with who, when, and from where</li>
              <li>Signatures that cannot be edited or deleted — by anyone</li>
              <li>Out-of-range readings can&rsquo;t be filed without a fix</li>
            </ul>
            <div className="lp-cta-row">
              <a className="lp-btn-primary" href={CONTACT}>
                Book a walkthrough
              </a>
              <a className="lp-btn-secondary" href="#logs">
                See what&rsquo;s in it
              </a>
            </div>
          </div>

          <div className="lp-hero-visual">
            <SampleLog />
          </div>
        </section>

        {/* ---------- the logs ---------- */}
        <section className="lp-section" id="logs">
          <div className="lp-section-head">
            <div>
              <h2 className="lp-section-title">What replaces the binder</h2>
              <p className="lp-section-sub">
                Seven standard logs, ready on day one. Each one is a form your
                administrator can edit — thresholds, fields, which shifts it
                is due in — not something we have to rebuild for you.
              </p>
            </div>
          </div>

          <div className="lp-logs">
            {LOGS.map(([name, cadence, detail]) => (
              <div className="lp-log" key={name}>
                <span className="lp-log-cadence">{cadence}</span>
                <h3>{name}</h3>
                <p>{detail}</p>
              </div>
            ))}
          </div>

          <div className="lp-note">
            <h3>Filling one in takes about fifteen seconds</h3>
            <p>
              The name, the date and the shift are already there &mdash; they
              were known the moment the page opened. Enter moves to the next
              field, numbers bring up a keypad, yes/no is one tap. An MA does
              it between patients, on the phone already in their pocket.
            </p>
          </div>
        </section>

        {/* ---------- onboarding & signatures ---------- */}
        <section className="lp-section" id="onboarding">
          <div className="lp-section-head">
            <div>
              <h2 className="lp-section-title">
                &ldquo;Nobody told me&rdquo; becomes a checkable claim
              </h2>
              <p className="lp-section-sub">
                New staff sign in and are walked through their packet before
                they can do anything else &mdash; HIPAA privacy and security,
                bloodborne pathogens, hazard communication, emergency
                procedures, Pennsylvania mandated reporting, and your own
                policies. Each one read, then signed by name and by hand.
              </p>
            </div>
          </div>

          <div className="lp-grid-3">
            <article className="lp-tile">
              <h3>Signatures are permanent</h3>
              <p>
                The database refuses to update or delete one. Not for an
                administrator, not for us, not for a migration that means
                well. A record that can be adjusted afterwards proves nothing
                about what happened before.
              </p>
            </article>
            <article className="lp-tile">
              <h3>The text is fingerprinted</h3>
              <p>
                Each signature stores a hash of the document exactly as it read
                on the day. Revise a policy and it becomes a new version;
                earlier signatures stay bound to what they actually agreed to,
                and the record flags any drift.
              </p>
            </article>
            <article className="lp-tile">
              <h3>Everyone can see their own</h3>
              <p>
                Any employee can open and print their complete record at any
                time. A record staff can&rsquo;t inspect isn&rsquo;t evidence
                they were informed &mdash; it&rsquo;s a claim by their
                employer.
              </p>
            </article>
          </div>
        </section>

        {/* ---------- security ---------- */}
        <section className="lp-section" id="security">
          <div className="lp-section-head">
            <div>
              <h2 className="lp-section-title">Built for what it now holds</h2>
              <p className="lp-section-sub">
                Named staff accounts, employment records, and drug counts are a
                different risk than an anonymous symptom checker. The controls
                match.
              </p>
            </div>
            <Link className="lp-section-link" href="/security">
              Full detail &rarr;
            </Link>
          </div>

          <div className="lp-grid-3">
            <article className="lp-tile">
              <h3>Invitation only</h3>
              <p>
                Signing in with Google proves who you are. It grants nothing.
                Access comes from an invitation an administrator issued, and an
                organization on Workspace can refuse every account outside its
                own domain.
              </p>
            </article>
            <article className="lp-tile">
              <h3>Two-step verification</h3>
              <p>
                A second factor we issue and verify ourselves, required for
                anyone with authority over other people&rsquo;s records. Not a
                setting we hope you turned on somewhere else.
              </p>
            </article>
            <article className="lp-tile">
              <h3>The kill switch is instant</h3>
              <p>
                Switching someone off stops the session already open on their
                phone, on its next tap &mdash; not at their next sign-in. Every
                administrative action is logged with the name of whoever did
                it.
              </p>
            </article>
            <article className="lp-tile">
              <h3>Separated in the database</h3>
              <p>
                Staff data lives in its own schema with no key linking it to
                the patient side in either direction. Every row is scoped to
                one organization by the database itself, not by application
                code that has to remember.
              </p>
            </article>
            <article className="lp-tile">
              <h3>Still no patient records</h3>
              <p>
                The triage tool remains anonymous: no accounts, no PHI, nothing
                stored about a visitor. That is a property worth protecting,
                and this side was built so it stays true.
              </p>
            </article>
            <article className="lp-tile">
              <h3>Your own address</h3>
              <p>
                Each clinic group runs at its own subdomain with its own
                branding. Staff go to the same address their patients do, which
                is one fewer thing to remember and one fewer thing to phish.
              </p>
            </article>
          </div>
        </section>

        {/* ---------- patient triage, now a feature ---------- */}
        <section className="lp-section" id="triage">
          <div className="lp-section-head">
            <div>
              <h2 className="lp-section-title">
                And the patient side still works
              </h2>
              <p className="lp-section-sub">
                The symptom checker this started as comes with it, under your
                brand, routing to your locations. Free for patients, no signup,
                nothing stored. Try it &mdash; this one is live and unscoped,
                so it will send you to whoever is genuinely nearest.
              </p>
            </div>
          </div>

          <div className="lp-triage-demo">
            <div className="lp-chat-card">
              <TriageApp contained deferDisclaimer />
            </div>
            <div className="lp-triage-notes">
              <p>
                <strong>Emergencies first.</strong> Red-flag screening runs in
                the browser and again on the server before anything else
                happens.
              </p>
              <p>
                <strong>Nearest, not sponsored.</strong> Clinics can&rsquo;t buy
                position. On a branded portal it routes to that brand&rsquo;s
                locations; here it routes to whoever is closest, competitors
                included.
              </p>
              <p>
                <strong>Not a diagnosis.</strong> It says so, repeatedly, and
                sends real emergencies to 911 or 988 rather than to a clinic.
              </p>
              {reads.length > 0 && (
                <p>
                  <strong>Health Reads.</strong> Plain-language topics from the
                  National Library of Medicine, refreshed daily —{" "}
                  <Link href="/reads">see today&rsquo;s</Link>, or the{" "}
                  <Link href="/monitor">flu monitor</Link>.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ---------- case study + CTA ---------- */}
        <section className="lp-section">
          <div className="lp-section-head">
            <div>
              <h2 className="lp-section-title">Running today</h2>
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
              We&rsquo;ll stand up a working version with your real locations,
              your branding, and your logs before you decide anything.
            </p>
            <div className="lp-cta-row">
              <a className="lp-btn-primary" href={CONTACT}>
                Book a walkthrough
              </a>
              <Link className="lp-btn-secondary" href="/security">
                Security &amp; compliance
              </Link>
            </div>
          </div>
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
            <Link href="/monitor">Health Monitor</Link>
            <Link href="/partners">White-label</Link>
          </span>
        </div>
        <p className="lp-footer-note">
          The patient tools are not a diagnosis and not a substitute for
          emergency care. If you are having a medical emergency, call 911. For a
          mental health crisis, call or text 988.
        </p>
      </footer>
    </div>
  );
}

// A still of the moment the product exists for: a reading outside its
// range, caught while the person is still standing in front of the
// thermometer.
//
// Marked "Example" and using no real clinic's name or numbers. Static
// markup rather than a screenshot so it stays sharp, stays in the site's
// own type, and cannot drift out of date without someone editing this file.
function SampleLog() {
  return (
    <figure className="lp-sample" aria-label="Example of a refrigerator temperature log">
      <figcaption className="lp-sample-cap">Example</figcaption>
      <div className="lp-sample-card">
        <div className="lp-sample-by">
          <span>K. Nguyen</span>
          <span>Today</span>
          <span className="lp-sample-slot">Opening</span>
        </div>
        <p className="lp-sample-title">Refrigerator temperatures</p>

        <div className="lp-sample-row">
          <span>Current</span>
          <span className="lp-sample-val lp-sample-bad">49.2 °F</span>
        </div>
        <div className="lp-sample-row">
          <span>24-hour minimum</span>
          <span className="lp-sample-val">38.1 °F</span>
        </div>
        <div className="lp-sample-row">
          <span>24-hour maximum</span>
          <span className="lp-sample-val lp-sample-bad">49.6 °F</span>
        </div>

        <div className="lp-sample-alert">
          <strong>Out of range: Current, 24-hour maximum</strong>
          <span>
            This log can still be submitted &mdash; it has to be, the reading is
            the record. Say what you did about it.
          </span>
        </div>
        <div className="lp-sample-btn">Submit with corrective action</div>
      </div>
    </figure>
  );
}

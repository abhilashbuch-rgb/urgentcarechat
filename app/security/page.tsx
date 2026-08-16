import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";

export const metadata = {
  title: "Security & compliance — urgentcare.chat",
  description:
    "What urgentcare.chat collects, what it doesn't, our subprocessors, and where we are on SOC 2 and HIPAA.",
};

// Deliberately plain-spoken and current-state. Written to be handed
// straight to a security reviewer during vendor assessment, which means
// it says what we do NOT have as clearly as what we do. Every claim here
// was checked against the code — see the commit that added this file.
export default function SecurityPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/" style={{ textDecoration: "none" }}>
            <BrandIcon />
            <span>
              urgentcare<span className="lp-tld">.chat</span>
            </span>
          </Link>
          <nav className="lp-nav-links">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a
              className="lp-nav-cta"
              href="mailto:urgentcarechat@icloud.com?subject=Security%20review"
            >
              Ask a security question
            </a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        <section className="sec-head">
          <span className="lp-eyebrow">
            <span className="lp-eyebrow-dot" aria-hidden="true" />
            Security &amp; compliance
          </span>
          <h1 className="lp-h1 sec-h1">
            The short version: we hold almost no data about your patients.
          </h1>
          <p className="lp-lede">
            This page is written for whoever runs your vendor review. It states
            what we have and what we don&apos;t, because you should be able to
            make this decision without taking our word for anything.
          </p>
        </section>

        <section className="sec-block">
          <h2 className="sec-h2">Where we stand on certifications</h2>
          <p className="sec-intro">
            Being direct, because these are the two questions every health
            system asks first:
          </p>

          <div className="sec-cert-grid">
            <div className="sec-cert">
              <span className="sec-chip sec-chip-no">Not audited</span>
              <h3>SOC 2</h3>
              <p>
                We do not have a SOC 2 report. Not a Type I and not a Type II.
                A SOC 2 is an attestation issued by a licensed CPA firm after
                an observation window — it isn&apos;t something a vendor can
                switch on per customer or per location, and we&apos;re not
                going to describe it that way. It is on our roadmap, and
                we&apos;ll say so plainly until the day a real report exists.
              </p>
            </div>

            <div className="sec-cert">
              <span className="sec-chip sec-chip-scope">Out of scope</span>
              <h3>HIPAA</h3>
              <p>
                We are not a HIPAA Business Associate today, and we have no
                BAA in place — because the triage chat collects no protected
                health information at all. There is no name, no date of birth,
                no insurance ID, and no account. Rather than claim compliance
                with a rule we don&apos;t fall under, we&apos;d rather show you
                the data we actually hold, below.
              </p>
            </div>
          </div>

          <div className="sec-callout">
            <strong>The condition that would change this:</strong>{" "}
            if we ever
            add booking that carries a patient identifier — a name attached to
            an appointment, for instance — we become a Business Associate at
            that moment. A signed BAA and real HIPAA controls become
            prerequisites for shipping it, not follow-up work. We&apos;d rather
            you hold us to that in writing now than discover it later.
          </div>
        </section>

        <section className="sec-block">
          <h2 className="sec-h2">What we actually store</h2>

          <div className="sec-table-wrap">
            <table className="sec-table">
              <thead>
                <tr>
                  <th scope="col">Surface</th>
                  <th scope="col">What&apos;s stored</th>
                  <th scope="col">Retention</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Triage conversation</th>
                  <td>
                    <strong>Nothing.</strong> Message content is sent to the
                    model to generate a reply and is not written to our
                    database. There is no transcript to subpoena, breach, or
                    hand over.
                  </td>
                  <td className="sec-none">Not retained</td>
                </tr>
                <tr>
                  <th scope="row">Clinic search</th>
                  <td>
                    The zip code searched. No IP address, no precise location.
                    If a patient uses &ldquo;near me,&rdquo; coordinates are
                    used for the lookup and never written down.
                  </td>
                  <td className="sec-none">Not retained</td>
                </tr>
                <tr>
                  <th scope="row">Clinic clicks</th>
                  <td>
                    A random per-browser session ID, which clinic was clicked,
                    the action (directions / call / website), and the searched
                    zip. The session ID is not linked to any identity and is
                    discarded when the browser tab closes.
                  </td>
                  <td>Retained for reporting</td>
                </tr>
                <tr>
                  <th scope="row">
                    Opt-in follow-up text <span className="sec-flag">only if used</span>
                  </th>
                  <td>
                    A phone number, and which clinic it relates to — collected
                    only when a patient explicitly types it in to receive one
                    check-in message. This is the single place we hold anything
                    identifiable about a patient. It can be disabled per tenant.
                  </td>
                  <td>
                    Retained after sending
                    <span className="sec-note">
                      Being straight with you: our privacy policy implies this
                      is deleted once the message goes out, and today the code
                      keeps it. We&apos;re fixing the code rather than softening
                      the policy.
                    </span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Listing claims</th>
                  <td>
                    A business contact name and email, submitted by clinic
                    staff — not patients.
                  </td>
                  <td>Retained until reviewed</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="sec-block">
          <h2 className="sec-h2">Controls in place today</h2>
          <ul className="sec-list">
            <li>
              <strong>No patient accounts.</strong> There is no login, no
              password, and no session to hijack — so there are no patient
              credentials to breach in the first place. Clinic staff do have
              named accounts, in a separate area on their own hostname; that
              side is described below.
            </li>
            <li>
              <strong>Row-level security on every table.</strong> The public
              key can only read clinic listings and active tenant branding, and
              can only insert claims and follow-up opt-ins. It cannot read
              them back.
            </li>
            <li>
              <strong>Staff tools are a separate database schema.</strong> The
              internal area clinic staff sign into holds no patient data and
              has no foreign key in either direction to the tables above, so a
              query written on one side cannot reach the other. Access is by
              invitation — signing in with Google proves identity and grants
              nothing on its own — and every row is scoped to one organization
              by row-level security rather than by application code.
            </li>
            <li>
              <strong>Privileged keys never reach the browser.</strong> The
              service-role database key and all third-party API keys live only
              in server-side environment variables.
            </li>
            <li>
              <strong>Rate limiting.</strong> The chat endpoint is capped per
              IP to limit abuse and cost.
            </li>
            <li>
              <strong>Emergency screening runs independently in two places.</strong>{" "}
              Red-flag detection runs in the browser and again on the server, so
              a failure in one layer doesn&apos;t mean an emergency goes
              unflagged.
            </li>
            <li>
              <strong>TLS everywhere,</strong> terminated at the edge, with no
              plaintext origin.
            </li>
            <li>
              <strong>Tenant portals are excluded from search indexes,</strong>{" "}
              so a branded deployment doesn&apos;t surface publicly before
              you&apos;re ready for it.
            </li>
          </ul>
        </section>

        <section className="sec-block">
          <h2 className="sec-h2">Subprocessors</h2>
          <p className="sec-intro">
            These vendors process data on our behalf. Several hold their own
            SOC 2 — that is <em>their</em> attestation covering{" "}
            <em>their</em> infrastructure, and we list it as context, not as a
            substitute for one of ours.
          </p>
          <div className="sec-table-wrap">
            <table className="sec-table">
              <thead>
                <tr>
                  <th scope="col">Vendor</th>
                  <th scope="col">Purpose</th>
                  <th scope="col">Sees</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Vercel</th>
                  <td>Hosting, CDN, edge routing</td>
                  <td>Requests in transit</td>
                </tr>
                <tr>
                  <th scope="row">Supabase</th>
                  <td>Postgres database</td>
                  <td>Everything in the table above</td>
                </tr>
                <tr>
                  <th scope="row">Anthropic</th>
                  <td>The model behind the conversation</td>
                  <td>Message content, not retained by us</td>
                </tr>
                <tr>
                  <th scope="row">Google</th>
                  <td>Clinic search and geocoding</td>
                  <td>Zip code or coordinates</td>
                </tr>
                <tr>
                  <th scope="row">Twilio</th>
                  <td>The opt-in follow-up text</td>
                  <td>
                    Phone number — only if that feature is enabled for you
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="sec-block sec-close">
          <h2 className="sec-h2">Questions we haven&apos;t answered here</h2>
          <p className="sec-intro">
            If your security team has a questionnaire, send it — we&apos;ll
            fill it in honestly, including the rows where the answer is
            &ldquo;not yet.&rdquo;
          </p>
          <a
            className="lp-btn-primary"
            href="mailto:urgentcarechat@icloud.com?subject=Security%20review"
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
            <Link href="/">Home</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/disclaimer">Disclaimer</Link>
          </span>
        </div>
        <p className="lp-footer-note">
          Last reviewed against the codebase on 12 August 2026. If anything on
          this page is out of date, that&apos;s a bug — tell us.
        </p>
      </footer>
    </div>
  );
}

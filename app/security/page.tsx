import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import { PRODUCT_NAME, OPERATOR, contactMailto } from "@/lib/site";

export const metadata = {
  title: `Security & compliance — ${PRODUCT_NAME}`,
  description:
    `What ${PRODUCT_NAME}'s compliance Binder collects, what it doesn't, its subprocessors, and where it stands on SOC 2 and HIPAA.`,
};

// Deliberately plain-spoken and current-state, same discipline as the
// page this replaced: says what we do NOT have as clearly as what we
// do, and every claim here was checked against the code — see
// lib/staff/*, supabase/staff-schema.sql, and supabase/staff-security.sql.
//
// ABOUT THE COMPLIANCE BINDER SPECIFICALLY — the staff-facing product
// this whole site markets (logs, credentials, obligations, the
// surveyor view). The embeddable triage widget is a different product
// with its own page, at /widget/security; this file used to describe
// that one by mistake, despite being the page every Binder marketing
// page links to.
export default function SecurityPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/" style={{ textDecoration: "none" }}>
            <BrandLockup />
          </Link>
          <nav className="lp-nav-links">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a className="lp-nav-cta" href={contactMailto("Security review")}>
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
            The short version: this is your staff&rsquo;s compliance record,
            not your patients&rsquo; charts.
          </h1>
          <p className="lp-lede">
            This page is written for whoever runs your vendor review. It
            states what we have and what we don&apos;t, because you should be
            able to make this decision without taking our word for anything.
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
                We do not have a SOC 2 report. Not a Type I and not a Type
                II. A SOC 2 is an attestation issued by a licensed CPA firm
                after an observation window — it isn&apos;t something a
                vendor can switch on per customer or per location, and
                we&apos;re not going to describe it that way. It is on our
                roadmap, and we&apos;ll say so plainly until the day a real
                report exists.
              </p>
            </div>

            <div className="sec-cert">
              <span className="sec-chip sec-chip-scope">Out of scope</span>
              <h3>HIPAA</h3>
              <p>
                We are not a HIPAA Business Associate, and we have no BAA in
                place — because this product doesn&apos;t process protected
                health information at all. It exists to help your clinic
                document its <em>own</em> OSHA and HIPAA compliance program —
                fridge temperatures, crash cart checks, staff credentials,
                training records — not to hold a patient chart, an
                appointment, or anything with a patient&apos;s name on it.
                There is no patient table in this product&apos;s schema.
              </p>
            </div>
          </div>

          <div className="sec-callout">
            <strong>The condition that would change this:</strong>{" "}if we ever
            add a feature that carries a patient identifier — a name attached
            to anything — we become a Business Associate at that moment. A
            signed BAA and real HIPAA controls become prerequisites for
            shipping it, not follow-up work. We&apos;d rather you hold us to
            that in writing now than discover it later.
          </div>
        </section>

        <section className="sec-block">
          <h2 className="sec-h2">What we actually store</h2>
          <p className="sec-intro">
            Employment and compliance records for your staff — never
            anything about your patients.
          </p>

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
                  <th scope="row">Staff accounts</th>
                  <td>
                    Name, legal name, work email, job title, role, and an
                    optional profile photo they upload themselves. No home
                    address, no SSN, no date of birth.
                  </td>
                  <td>Kept while the account is active</td>
                </tr>
                <tr>
                  <th scope="row">Compliance logs</th>
                  <td>
                    Equipment readings and checklist answers (a fridge
                    temperature, an O2 cylinder&apos;s pressure, a narcotics
                    count), who filed it and when, where it was filed from,
                    and an optional photo of the <strong>equipment</strong>{" "}—
                    never a patient.
                  </td>
                  <td>
                    Kept indefinitely
                    <span className="sec-note">
                      This is the compliance record itself — the whole point
                      is that it still exists when a surveyor asks for it.
                      Rows are never edited or deleted; a correction adds a
                      new, linked entry and keeps the original.
                    </span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Credentials</th>
                  <td>
                    License/certification type, issuing body, and expiry
                    date, plus an optional photo of the physical card.
                  </td>
                  <td>Kept while the credential is on file</td>
                </tr>
                <tr>
                  <th scope="row">Obligations</th>
                  <td>
                    A deadline register — title, due date, who owns it, the
                    regulation or contract behind it, and the evidence note
                    a person writes themselves when they complete it.
                  </td>
                  <td>Kept indefinitely</td>
                </tr>
                <tr>
                  <th scope="row">Inventory (add-on)</th>
                  <td>
                    A stock catalog and count history — quantity, expiration,
                    an optional photo of the shelf or item.
                  </td>
                  <td>Kept indefinitely</td>
                </tr>
                <tr>
                  <th scope="row">Audit log</th>
                  <td>
                    Every administrative action — who signed in, who changed
                    a setting, who moved a due date — with the actor and
                    timestamp.
                  </td>
                  <td>Kept indefinitely</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="sec-block">
          <h2 className="sec-h2">Controls in place today</h2>
          <ul className="sec-list">
            <li>
              <strong>No patient data, by design.</strong>{" "}There is no
              patient table anywhere in this product&apos;s schema — not a
              missing feature, an absent one.
            </li>
            <li>
              <strong>No self-signup.</strong>{" "}Every account is invited by an
              administrator. Signing in is by Google, or an emailed six-digit
              code that expires in ten minutes and is capped at five wrong
              attempts before it&apos;s dead — the code, not the account.
            </li>
            <li>
              <strong>Mandatory second factor for anyone with authority over
              other people&apos;s records.</strong>{" "}Administrators, owners,
              and clinical leads must enroll a TOTP authenticator to reach
              anything. There is no setting in the app to turn this off.
            </li>
            <li>
              <strong>Row-level security on every table, enforced by the
              database.</strong>{" "}Each row is scoped to one clinic; a bug in a
              route can ask for the wrong org&apos;s data and simply not
              receive it, because the database — not application code — is
              what refuses it.
            </li>
            <li>
              <strong>The compliance ledger is append-only, and the database
              enforces it.</strong>{" "}Editing or deleting a filed log is
              refused by a trigger, not just discouraged by the interface. A
              correction inserts a new row pointing at the one it replaces
              and requires a written reason; nothing is ever silently
              changed.
            </li>
            <li>
              <strong>Each log entry is chained to the one before it with a
              hash.</strong>{" "}The same idea a tamper-evident ledger uses
              elsewhere — a row edited outside the application would break
              the chain visibly.
            </li>
            <li>
              <strong>Photos live in a private bucket,</strong>{" "}reachable
              only through a short-lived signed link generated on request,
              never a public URL.
            </li>
            <li>
              <strong>One narrow, disclosed use of a third-party AI
              model:</strong>{" "}reading a tightly cropped photo of a digital
              display back as a proposed number — nothing else is sent, the
              image is used for that one call and never saved, and the
              record itself is written the same way a typed number would be.
            </li>
            <li>
              <strong>Bearer links (the inspector view, calendar
              subscriptions) are 256-bit random tokens.</strong>{" "}Only a hash
              is ever stored, so a database copy yields no working link, and
              every link is individually revocable.
            </li>
            <li>
              <strong>A lapsed subscription makes an account read-only, never
              deletes anything.</strong>{" "}A clinic&apos;s own compliance
              history is never held hostage to a billing problem.
            </li>
            <li>
              <strong>Session cookies are signed and carry a revocation
              epoch.</strong>{" "}Deactivating someone ends every session they
              hold, everywhere, on their next request.
            </li>
            <li>
              <strong>Privileged keys never reach the browser.</strong>{" "}The
              database service-role key and every third-party API key live
              only in server-side environment variables.
            </li>
            <li><strong>TLS everywhere,</strong>{" "}terminated at the edge, with no plaintext origin.</li>
          </ul>
        </section>

        <section className="sec-block">
          <h2 className="sec-h2">Subprocessors</h2>
          <p className="sec-intro">
            These vendors process data on our behalf. Several hold their own
            SOC 2 — that is <em>their</em> attestation covering{" "}
            <em>their</em> infrastructure, and we list it as context, not as
            a substitute for one of ours.
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
                  <td>Postgres database and file storage</td>
                  <td>Everything in the table above</td>
                </tr>
                <tr>
                  <th scope="row">Google</th>
                  <td>Sign-in</td>
                  <td>Email address, for identity only</td>
                </tr>
                <tr>
                  <th scope="row">Resend</th>
                  <td>Transactional email — alerts, digests, sign-in codes</td>
                  <td>Recipient address and message content</td>
                </tr>
                <tr>
                  <th scope="row">Stripe</th>
                  <td>Billing</td>
                  <td>Payment details, never our servers</td>
                </tr>
                <tr>
                  <th scope="row">Anthropic</th>
                  <td>
                    The one narrow vision-read call described above
                  </td>
                  <td>A cropped equipment-display photo, not retained by us</td>
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
          <a className="lp-btn-primary" href={contactMailto("Security review")}>
            Send it to us
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
            <Link href="/guides">Guides</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/disclaimer">Disclaimer</Link>
          </span>
        </div>
        <p className="lp-footer-note">
          Last reviewed against the codebase on 17 September 2026. If
          anything on this page is out of date, that&apos;s a bug — tell us.
        </p>
      </footer>
    </div>
  );
}

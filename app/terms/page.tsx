import Link from "next/link";

export const metadata = {
  title: "Terms of Service — urgentcare.chat",
};

export default function TermsPage() {
  return (
    <div className="legal-page">
      <header className="site-header">
        <div className="brand">
          <span className="dot"></span>urgentcare
          <span className="tld">.chat</span>
        </div>
      </header>

      <main className="legal-main">
        <div className="legal-draft-banner">
          <strong>Draft — not final.</strong> This page has not been reviewed
          by an attorney. It is a starting point, not a finished legal
          document — arbitration, governing-law, and liability-limitation
          language in particular need professional drafting before launch.
        </div>

        <h1 className="legal-title">Terms of Service</h1>
        <p className="legal-updated">Last updated: [DATE]</p>

        <section className="legal-section">
          <h2>1. Who we are</h2>
          <p>
            urgentcare.chat is a brand operated by Medicin.io LLC
            (&quot;Medicin.io,&quot; &quot;we,&quot; &quot;us&quot;). By using
            this site, you agree to these terms.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. The service</h2>
          <p>
            urgentcare.chat offers (a) a free AI-assisted chat that helps you
            describe symptoms and find a nearby urgent care clinic, and (b) a
            paid service that connects you with an independent, licensed
            healthcare provider for a telehealth consultation. See our{" "}
            <Link href="/disclaimer">Platform Disclaimer</Link> for details
            on what each service is and isn&apos;t.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Eligibility</h2>
          <p>
            The paid telehealth connection is currently available only to
            users who are physically located, at the time of the call, in a
            state where the connected provider is licensed. You must
            accurately confirm your location when asked; providing false
            information to access this service may result in denial of
            service and forfeiture of the fee.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. Payment</h2>
          <p>
            The platform fee for the telehealth connection is charged after
            a screening step and before you are connected. It is
            non-refundable once the provider has been notified and made
            available to connect, except where required by law. This fee
            covers the technology/scheduling service only — it does not
            cover, and is separate from, the medical consultation itself,
            which is provided and (if applicable) billed by the independent
            provider&apos;s own practice.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Prohibited use</h2>
          <p>
            Don&apos;t use urgentcare.chat to seek medication for misuse,
            impersonate another person, attempt to reverse-identify another
            user or provider, or use the service for anything other than
            your own (or, when specified, your dependent&apos;s) care.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. No warranty; limitation of liability</h2>
          <p>
            The service is provided &quot;as is.&quot; Medicin.io LLC
            disclaims all warranties to the fullest extent permitted by law
            and is not liable for clinical outcomes, which are the
            responsibility of the independent healthcare provider and their
            practice. [Placeholder — liability caps, indemnification, and
            dispute-resolution terms require attorney drafting specific to
            your state and business structure.]
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Changes</h2>
          <p>
            We may update these terms from time to time. Continued use of
            the service after a change means you accept the updated terms.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Contact</h2>
          <p>[CONTACT EMAIL / ADDRESS]</p>
        </section>

        <p className="legal-links">
          <Link href="/privacy">Privacy Policy</Link> ·{" "}
          <Link href="/disclaimer">Platform Disclaimer</Link> ·{" "}
          <Link href="/">Back to chat</Link>
        </p>
      </main>
    </div>
  );
}

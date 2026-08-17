import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";
import Wordmark from "@/app/components/Wordmark";
import { PRODUCT_NAME, OPERATOR } from "@/lib/site";

export const metadata = {
  title: `Terms of Service — ${PRODUCT_NAME}`,
};

export default function TermsPage() {
  return (
    <div className="legal-page">
      <header className="site-header">
        <div className="brand">
          <BrandIcon />
          <Wordmark />
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
            {PRODUCT_NAME} is a brand operated by {OPERATOR}{" "}
            (&quot;Medicin.io,&quot; &quot;we,&quot; &quot;us&quot;). By using
            this site, you agree to these terms.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. The service</h2>
          <p>
            {PRODUCT_NAME} offers a free AI-assisted chat that helps you
            describe symptoms and find a nearby urgent care clinic. See our{" "}
            <Link href="/disclaimer">Platform Disclaimer</Link>{" "}
            for details on what the service is and isn&apos;t.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Prohibited use</h2>
          <p>
            Don&apos;t use {PRODUCT_NAME}{" "}
            to seek medication for misuse,
            impersonate another person, or use the service for anything
            other than your own (or, when specified, your dependent&apos;s)
            care.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. No warranty; limitation of liability</h2>
          <p>
            The service is provided &quot;as is.&quot; Medicin.io LLC
            disclaims all warranties to the fullest extent permitted by law
            and is not liable for clinical outcomes, which are the
            responsibility of the independent urgent care clinics the
            service helps you find. [Placeholder — liability caps,
            indemnification, and dispute-resolution terms require attorney
            drafting specific to your state and business structure.]
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Changes</h2>
          <p>
            We may update these terms from time to time. Continued use of
            the service after a change means you accept the updated terms.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Contact</h2>
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

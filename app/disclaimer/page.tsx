import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import { PRODUCT_NAME, OPERATOR } from "@/lib/site";

export const metadata = {
  title: `Platform Disclaimer — ${PRODUCT_NAME}`,
};

export default function DisclaimerPage() {
  return (
    <div className="legal-page">
      <header className="site-header">
        <div className="brand">
          <BrandLockup />
        </div>
      </header>

      <main className="legal-main">
        <div className="legal-draft-banner">
          <strong>Draft — not final.</strong> This page has not been reviewed
          by a healthcare attorney. Do not treat this as legally sufficient
          until it has been reviewed and approved for your specific business
          structure, state, and payer relationships.
        </div>

        <h1 className="legal-title">Platform Disclaimer</h1>
        <p className="legal-updated">Last updated: [DATE]</p>

        <section className="legal-section">
          <h2>What {PRODUCT_NAME} is</h2>
          <p>
            {PRODUCT_NAME} is a brand operated by {OPERATOR}, a
            technology infrastructure company. Through this site,
            Medicin.io LLC provides an AI-assisted symptom-information and
            clinic-finder tool at no cost.
          </p>
          <p>
            Medicin.io LLC does not practice medicine, does not provide
            medical advice, does not diagnose conditions, does not prescribe
            medications, and does not maintain clinical records.
          </p>
        </section>

        <section className="legal-section">
          <h2>The free triage chat</h2>
          <p>
            The chat assistant is an AI system, not a doctor. It does not
            diagnose or treat. It helps you describe what&apos;s going on and
            find a nearby urgent care clinic. If it detects language
            suggesting a medical emergency or a mental health crisis, it will
            direct you to call 911 or contact the 988 Suicide &amp; Crisis
            Lifeline — it cannot reliably detect every emergency, so always
            use your own judgment and call 911 if you believe this is an
            emergency.
          </p>
        </section>

        <section className="legal-section">
          <h2>Emergencies</h2>
          <p>
            {PRODUCT_NAME} is not a substitute for 911 or emergency
            medical services. If you are experiencing a medical emergency,
            call 911 or go to the nearest emergency room now.
          </p>
          <p>
            If you are in crisis or having thoughts of suicide or self-harm,
            call or text <strong>988</strong>{" "}
            (Suicide &amp; Crisis Lifeline)
            or text HOME to <strong>741741</strong> (Crisis Text Line).
          </p>
        </section>

        <p className="legal-links">
          <Link href="/terms">Terms of Service</Link> ·{" "}
          <Link href="/privacy">Privacy Policy</Link> ·{" "}
          <Link href="/">Back to chat</Link>
        </p>
      </main>
    </div>
  );
}

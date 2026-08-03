import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";

export const metadata = {
  title: "Platform Disclaimer — urgentcare.chat",
};

export default function DisclaimerPage() {
  return (
    <div className="legal-page">
      <header className="site-header">
        <div className="brand">
          <BrandIcon />
          urgentcare<span className="tld">.chat</span>
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
          <h2>What urgentcare.chat is</h2>
          <p>
            urgentcare.chat is a brand operated by Medicin.io LLC, a
            technology infrastructure company. Through this site,
            Medicin.io LLC provides an AI-assisted symptom-information and
            clinic-finder tool at no cost, and — separately — a paid
            technology/scheduling service that connects patients with
            independent, licensed healthcare providers for a telehealth
            consultation.
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
          <h2>The paid telehealth connection</h2>
          <p>
            When you pay to connect with a doctor or nurse practitioner
            through urgentcare.chat, that fee covers the technology and
            scheduling service only — the platform, payment processing, and
            connection infrastructure. It does not cover, and is not billed
            as, the medical consultation itself.
          </p>
          <p>
            The healthcare provider you are connected with is affiliated
            with, employed by, and supervised by their own independent
            medical practice (for example, an urgent care clinic) — not by
            Medicin.io LLC. All clinical decisions, diagnoses, treatment
            recommendations, documentation, and associated liability rest
            with that independent provider and their practice, not with
            Medicin.io LLC.
          </p>
          <p>
            This connection service is currently limited to patients who are
            physically located, at the time of the call, in a state where
            the connected provider is licensed to practice.
          </p>
        </section>

        <section className="legal-section">
          <h2>How the connection works</h2>
          <p>
            Once payment is confirmed, the provider is notified and connects
            with you by phone through an encrypted, masked-number bridge —
            your phone number is not shared with the provider, and theirs is
            not shared with you — or by secure video, depending on
            availability. Medicin.io LLC does not listen to, record, or
            store the contents of that call.
          </p>
        </section>

        <section className="legal-section">
          <h2>What we don&apos;t keep</h2>
          <p>
            The description of symptoms you provide before payment is used
            only to screen for emergencies and to give the provider brief
            context, and is deleted from our systems once that context has
            been relayed. We do not retain diagnoses, treatment plans, or
            clinical notes — those live only with the provider and their
            practice&apos;s own medical records, subject to their own
            recordkeeping obligations.
          </p>
        </section>

        <section className="legal-section">
          <h2>Payment</h2>
          <p>
            The platform fee is charged only once the pre-payment screening
            step determines your situation is appropriate for this service.
            It is generally non-refundable once the provider has been
            notified and made available to connect, except where required by
            law. The fee may be eligible for HSA/FSA reimbursement depending
            on your specific plan&apos;s rules; Medicin.io LLC makes no
            guarantee of eligibility or coverage.
          </p>
        </section>

        <section className="legal-section">
          <h2>Emergencies</h2>
          <p>
            urgentcare.chat — including both the free chat and the paid
            telehealth connection — is not a substitute for 911 or emergency
            medical services. If you are experiencing a medical emergency,
            call 911 or go to the nearest emergency room now.
          </p>
          <p>
            If you are in crisis or having thoughts of suicide or self-harm,
            call or text <strong>988</strong> (Suicide &amp; Crisis Lifeline)
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

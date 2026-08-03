import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";

export const metadata = {
  title: "Privacy Policy — urgentcare.chat",
};

export default function PrivacyPage() {
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
          by an attorney and doesn&apos;t yet address CCPA/GDPR-specific
          obligations in detail. Review before launch.
        </div>

        <h1 className="legal-title">Privacy Policy</h1>
        <p className="legal-updated">Last updated: [DATE]</p>

        <section className="legal-section">
          <h2>What we collect</h2>
          <p>
            <strong>Free triage chat:</strong> an anonymous, random session
            ID (not tied to your identity), the zip code you search with,
            and which clinics you click. Conversation summaries are kept for
            30 days for quality review, then automatically deleted — we
            never store the raw chat text.
          </p>
          <p>
            <strong>Paid telehealth connection:</strong> your phone number
            (used only to set up the masked call bridge — never shared with
            the provider), your name and date of birth (used only to match
            your visit to your medical record with the provider&apos;s
            practice — see below), and a brief description of what&apos;s
            going on (used to screen for emergencies and to give the
            provider brief context, then deleted once relayed). Payment is
            handled entirely by Stripe — we never see or store your card
            details.
          </p>
          <p>
            <strong>Visit documentation:</strong> after a telehealth call,
            the provider may submit a visit note, which we transmit to their
            practice&apos;s medical record system so your visit is properly
            documented. Once that transmission succeeds, we delete our own
            copy of the note and your name/date of birth — the medical
            record itself lives with the provider&apos;s practice, not with
            us.
          </p>
          <p>
            <strong>Optional follow-up text:</strong> if you opt in after
            viewing a clinic, we store your phone number only to send that
            one check-in text.
          </p>
          <p>
            <strong>Clinic claim requests:</strong> if you submit a request
            to claim a clinic listing, we store the contact information you
            provide to review the request.
          </p>
        </section>

        <section className="legal-section">
          <h2>What we don&apos;t collect</h2>
          <p>
            We never ask for your Social Security number, insurance member
            ID, or home address, in either the free chat or the paid
            telehealth connection. The free chat never collects your name or
            date of birth either — only the paid telehealth connection does,
            and only because a real medical record requires it (see above).
          </p>
        </section>

        <section className="legal-section">
          <h2>Who we share data with</h2>
          <p>
            Service providers who process data on our behalf: Stripe
            (payments), Twilio (SMS and masked calling), Supabase (database
            hosting), Anthropic (the AI model powering the chat), Google
            (clinic search and geocoding), and the video/chat platform used
            for telehealth sessions (e.g. Doxy.me). We do not sell your data.
          </p>
        </section>

        <section className="legal-section">
          <h2>Data retention</h2>
          <p>
            Clinic click analytics are tied to an anonymous session ID, never
            your identity. Conversation summaries auto-purge after 30 days.
            Telehealth symptom descriptions are deleted immediately after
            being relayed to the provider. Phone numbers collected for a
            one-time follow-up text or a telehealth connection are retained
            only as long as needed to fulfill that purpose.
          </p>
        </section>

        <section className="legal-section">
          <h2>Children</h2>
          <p>
            This service is not directed at children. If you&apos;re
            describing a child&apos;s symptoms as their parent or guardian,
            we don&apos;t collect the child&apos;s identity — only the
            symptom description and your own contact information where
            applicable.
          </p>
        </section>

        <section className="legal-section">
          <h2>Contact</h2>
          <p>[CONTACT EMAIL / ADDRESS]</p>
        </section>

        <p className="legal-links">
          <Link href="/terms">Terms of Service</Link> ·{" "}
          <Link href="/disclaimer">Platform Disclaimer</Link> ·{" "}
          <Link href="/">Back to chat</Link>
        </p>
      </main>
    </div>
  );
}

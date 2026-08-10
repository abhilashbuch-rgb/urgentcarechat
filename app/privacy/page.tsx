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
            ID, home address, name, or date of birth.
          </p>
        </section>

        <section className="legal-section">
          <h2>Who we share data with</h2>
          <p>
            Service providers who process data on our behalf: Twilio (SMS
            for the opt-in follow-up text), Supabase (database hosting),
            Anthropic (the AI model powering the chat), and Google (clinic
            search and geocoding). We do not sell your data.
          </p>
        </section>

        <section className="legal-section">
          <h2>Data retention</h2>
          <p>
            Clinic click analytics are tied to an anonymous session ID, never
            your identity. Conversation summaries auto-purge after 30 days.
            Phone numbers collected for a one-time follow-up text are
            retained only as long as needed to fulfill that purpose.
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

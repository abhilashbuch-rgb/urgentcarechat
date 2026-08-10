import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";

export const metadata = {
  title: "White-label — urgentcare.chat",
};

export default function PartnersPage() {
  return (
    <div className="legal-page">
      <header className="site-header">
        <div className="brand">
          <BrandIcon />
          urgentcare<span className="tld">.chat</span>
        </div>
      </header>

      <main className="legal-main">
        <h1 className="legal-title">White-label this platform</h1>
        <p className="legal-updated">
          For urgent care groups &amp; MSOs &middot; A HIPAAspeak companion
        </p>

        <section className="legal-section">
          <p>
            Run your own branded AI-guided symptom triage and clinic-finder
            experience on the same platform powering urgentcare.chat &mdash;
            under your own name and domain.
          </p>
        </section>

        <section className="legal-section">
          <h2>Interested?</h2>
          <p>
            <a href="mailto:urgentcarechat@icloud.com?subject=White-label%20inquiry">
              urgentcarechat@icloud.com
            </a>
          </p>
        </section>

        <p className="legal-links">
          <Link href="/">Back to chat</Link>
        </p>
      </main>
    </div>
  );
}

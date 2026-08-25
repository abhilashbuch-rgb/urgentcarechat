import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import { PRODUCT_NAME, contactMailto } from "@/lib/site";

export const metadata = {
  title: `White-label — ${PRODUCT_NAME}`,
};

export default function PartnersPage() {
  return (
    <div className="legal-page">
      <header className="site-header">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          <BrandLockup />
        </Link>
      </header>

      <main className="legal-main">
        <h1 className="legal-title">White-label this platform</h1>
        <p className="legal-updated">
          For urgent care groups &amp; MSOs &middot; A HIPAAspeak companion
        </p>

        <section className="legal-section">
          <p>
            Run your own branded AI-guided symptom triage and clinic-finder
            experience on the same platform powering {PRODUCT_NAME}{" "}
            &mdash;
            under your own name and domain.
          </p>
        </section>

        <section className="legal-section">
          <h2>Interested?</h2>
          <p>
            <a href={contactMailto("White-label inquiry")}>
              Email us about a white-label portal
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

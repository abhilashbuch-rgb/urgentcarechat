import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";

// Root urgentcare.chat is now an explainer/CTA page, not the live triage
// tool — the actual chat only runs under a branded tenant subdomain
// (see app/t/[tenant] and proxy.ts). See TriageApp.tsx for that
// experience; it's unchanged, just relocated.
export default function LandingPage() {
  return (
    <div className="legal-page">
      <header className="site-header">
        <div className="brand">
          <BrandIcon />
          urgentcare<span className="tld">.chat</span>
        </div>
      </header>

      <main className="legal-main">
        <h1 className="legal-title">AI triage and clinic-finder, on your own domain.</h1>
        <p className="legal-updated">Free for patients &middot; branded for you</p>

        <section className="legal-section">
          <h2>What this is</h2>
          <p>
            A conversational AI that helps someone describe what&apos;s
            going on, flags real emergencies straight to 911 or 988, and
            finds the right nearby urgent care — with live wait times and
            real clinic data, not a static directory. No signup, no PHI
            collected, ever.
          </p>
        </section>

        <section className="legal-section">
          <h2>Who it&apos;s for</h2>
          <p>
            Urgent care groups and multi-location chains who want their own
            branded version of this running on their own subdomain —
            deflecting front-desk call volume and routing patients to the
            right location, under their own name, not ours.
          </p>
        </section>

        <section className="legal-section">
          <h2>Get your own branded portal</h2>
          <p>
            <Link href="/partners">See how white-labeling this works</Link>{" "}
            or reach out directly at{" "}
            <a href="mailto:urgentcarechat@icloud.com?subject=Branded%20portal%20inquiry">
              urgentcarechat@icloud.com
            </a>
            .
          </p>
        </section>

        <p className="legal-links">
          <Link href="/terms">Terms</Link> ·{" "}
          <Link href="/privacy">Privacy</Link> ·{" "}
          <Link href="/disclaimer">Disclaimer</Link> ·{" "}
          <Link href="/reads">Health Reads</Link>
        </p>
      </main>
    </div>
  );
}

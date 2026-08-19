import BrandLockup from "@/app/components/BrandLockup";
import type { Metadata } from "next";
import Link from "next/link";
import TrialForm from "@/app/components/TrialForm";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Start a trial — ${PRODUCT_NAME}`,
  description:
    "Fourteen days, no credit card. Set up your clinic's compliance workspace in about a minute.",
  robots: { index: true, follow: true },
};

export default function StartTrial() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/">
            <BrandLockup />
          </Link>
          <nav className="lp-nav-links">
            <a href="/staff/signin">Sign in</a>
          </nav>
        </div>
      </header>

      <main className="lp-main tr-main">
        <div className="tr-card">
          <h1 className="tr-h1">Start your clinic&rsquo;s trial</h1>
          <p className="tr-lede">
            Two fields, then sign in &mdash; with Google or with an emailed
            code, whichever your inbox is on. Your logs are ready to run the
            same day.
          </p>
          <TrialForm />
        </div>
      </main>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";
import TrialForm from "@/app/components/TrialForm";

export const metadata: Metadata = {
  title: "Start a trial — medicin.io",
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
            <BrandIcon />
            <span>
              medicin<span className="lp-tld">.io</span>
            </span>
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
            Two fields, then sign in with Google. Your logs are ready to run
            the same day.
          </p>
          <TrialForm />
        </div>
      </main>
    </div>
  );
}

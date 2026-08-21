import BrandLockup from "@/app/components/BrandLockup";
import DemoWizard from "@/app/components/demo/DemoWizard";
import Link from "next/link";
import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Set up a demo clinic — ${PRODUCT_NAME}`,
  description:
    "Pick your facility type, switch off what you do not own, and open the shift board your clinic would actually get. No account.",
  robots: { index: false, follow: false },
};

// WHAT THIS PAGE WAS. Four role cards — medical assistant, provider, any
// staff member, surveyor — each opening a fixed screen. It answered "who
// are you", which is a question nobody evaluating this has. They want to
// see THEIR clinic, and a med spa owner shown a board with a lead-apron
// inspection on it concludes the product is for somebody else.
//
// The three role screens it linked to still exist and are still linked
// from the bottom of this page. They are the second thing to look at,
// not the first.

export default function DemoIndex() {
  return (
    <div className="st-page st-page-narrow demo-index">
      <header className="demo-index-head">
        <Link href="/" className="demo-index-brand">
          <BrandLockup />
        </Link>
        <Link href="/start" className="demo-index-cta">
          Start the real trial
        </Link>
      </header>

      <h1 className="st-h1">Set up a demo clinic</h1>
      <p className="st-page-sub">
        Two questions and you are looking at the board your own clinic would
        get &mdash; not a screenshot of somebody else&rsquo;s. Nothing is
        saved and no account is created.
      </p>

      <DemoWizard />

      <section className="demo-alt">
        <h2 className="demo-wiz-sub">Or look at one screen on its own</h2>
        <ul className="demo-alt-list">
          <li>
            <Link href="/demo/learning">
              <strong>Emergency guides</strong>
              <span>
                Every step visible at once, nothing to sign, nothing
                collapsed.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/demo/documents">
              <strong>Your own credential shelf</strong>
              <span>
                BLS, licence, CME &mdash; with expiry called out early
                enough to renew.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/demo/surveyor">
              <strong>The inspection vault</strong>
              <span>
                Read-only, 90 days of history, nothing financial in sight.
              </span>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

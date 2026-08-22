import BrandLockup from "@/app/components/BrandLockup";
import DemoWizard from "@/app/components/demo/DemoWizard";
import Link from "next/link";
import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Try it on your own clinic — ${PRODUCT_NAME}`,
  description:
    "Pick your facility type, switch off the equipment you do not have, and open the compliance board your clinic would actually get. No account, no card, nothing saved.",
  // INDEXED, unlike the rest of the demo tree.
  //
  // The whole demo used to be noindex, which was right when it was four
  // fixed screens you were handed a link to. It is now the page that
  // answers the question somebody types into a search box — "does this
  // thing fit a clinic like mine" — and it answers it by letting them
  // build one. That is a landing page, so it is treated as one.
  //
  // Canonical without the query string: /demo?c=urgent_care.autoclave
  // and its permutations are the same page with a different starting
  // state, and letting a crawler treat each as its own URL would spend
  // the crawl budget for this site on combinations nobody searched for.
  robots: { index: true, follow: true },
  alternates: { canonical: "/demo" },
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

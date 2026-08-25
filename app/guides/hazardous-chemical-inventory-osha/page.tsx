import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata = {
  title: `Hazardous chemical inventory & SDS access (OSHA HazCom) — ${PRODUCT_NAME}`,
  description:
    "What 29 CFR 1910.1200 actually requires for a hazardous chemical list and safety data sheets at a clinic — and the one check a surveyor runs first.",
};

// Same citations as the 'hazcom-inventory' template in
// supabase/staff-statutory-logs.sql, written as prose rather than as a
// form's field list. If this page and that template ever disagree about
// what the rule says, that file is the one to fix.
export default function HazcomInventoryGuide() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/" style={{ textDecoration: "none" }}>
            <BrandLockup />
          </Link>
          <nav className="lp-nav-links">
            <Link href="/demo">See a live demo</Link>
            <a href="/start" className="lp-nav-install">
              Install now
            </a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        <Link href="/guides" className="guide-back">
          ← All guides
        </Link>

        <section className="guide-head">
          <span className="lp-eyebrow">
            <span className="lp-eyebrow-dot" aria-hidden="true" />
            29 CFR 1910.1200
          </span>
          <h1 className="lp-h1 guide-h1">
            Hazardous chemical inventory &amp; SDS access
          </h1>
          <p className="lp-lede">
            OSHA&apos;s Hazard Communication Standard reduces to two plain
            questions: do you know what&apos;s in the building, and can a
            staff member actually get to the safety data sheet for it right
            now — not eventually.
          </p>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">The chemical list</h2>
          <p>
            29 CFR 1910.1200(e)(1)(i) requires a list of the hazardous
            chemicals known to be present in the workplace. In a clinic
            that&apos;s cleaning solutions, disinfectants, reagents, and
            anything else with a hazard on its own label — not just what a
            lab technically classifies as a chemical.
          </p>
          <p>
            <strong>The list has to match the shelf.</strong>{" "}A list that
            was accurate when it was written and hasn&apos;t been checked
            since is the single most common finding here — walk the storage
            area and reconcile the list against what&apos;s actually there,
            not just what was ordered last year.
          </p>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">
            &ldquo;Readily accessible&rdquo; is the standard, and it&apos;s
            stricter than it sounds
          </h2>
          <p>
            29 CFR 1910.1200(g)(8) requires safety data sheets be readily
            accessible to employees in their work area during each work
            shift. A binder in a locked office down the hall doesn&apos;t
            meet that bar — accessible means a staff member handling a
            chemical spill can reach the SDS without finding a manager
            first.
          </p>
          <div className="guide-callout">
            <strong>This is usually the first thing a surveyor checks.</strong>{" "}
            Ask a staff member — not the office manager — to produce the
            SDS for something on the shelf, right now, without a phone call.
            If that takes more than a minute, the storage location is the
            finding, not the paperwork.
          </div>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">Secondary containers</h2>
          <p>
            A chemical decanted out of its original bottle into a smaller
            spray bottle or container still needs a label identifying its
            contents and hazards — an unlabeled spray bottle of something
            caustic is a hazard to whoever picks it up next, including
            someone who wasn&apos;t there when it was filled.
          </p>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">What&apos;s not required</h2>
          <p>
            There&apos;s no federal rule that a clinic must stock or
            inventory any specific chemical, and no requirement to run this
            log at all if the building genuinely has nothing on the list —
            a med spa or a dental practice with no reportable chemicals
            beyond ordinary cleaning supplies covered by the manufacturer&apos;s
            own labeling may have very little to track here. The rule is
            about accuracy for what&apos;s actually present, not about
            maintaining a list for its own sake.
          </p>
        </section>

        <section className="guide-close">
          <h2 className="guide-h2">
            {PRODUCT_NAME}{" "}keeps the list and the SDS access check on the
            same quarterly rhythm
          </h2>
          <p>
            One filing reconciles the list against the shelf, confirms SDS
            access, and checks secondary-container labeling — with a
            timestamp that answers the surveyor&apos;s next question before
            they ask it.
          </p>
          <Link className="lp-btn-primary" href="/start">
            Start the 30-day trial
          </Link>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-footer-brand">
            {PRODUCT_NAME}{" "}&mdash; a Medicin.io LLC product
          </span>
          <span className="lp-footer-links">
            <Link href="/guides">All guides</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

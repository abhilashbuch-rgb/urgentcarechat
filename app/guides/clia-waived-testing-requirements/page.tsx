import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata = {
  title: `CLIA-waived testing requirements, explained — ${PRODUCT_NAME}`,
  description:
    "What 42 CFR 493.15(e)(1) actually requires for CLIA-waived testing — and why most of what clinics believe about QC frequency comes from the package insert, not federal law.",
};

// Same reasoning already vetted for the 'urinalysis-qc' template in
// supabase/staff-optional-logs.sql — this restates it as an explainer
// rather than as a form.
export default function ClaWaivedTestingGuide() {
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
            42 CFR 493.15(e)(1)
          </span>
          <h1 className="lp-h1 guide-h1">
            CLIA-waived testing: what the rule actually requires
          </h1>
          <p className="lp-lede">
            For a CLIA-waived test — a rapid strep, a urinalysis strip, a
            glucometer — the entire federal quality-control requirement is
            one sentence long. Almost everything else you&apos;ve heard
            about how often to run controls comes from somewhere else.
          </p>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">The rule, in full</h2>
          <div className="guide-callout">
            <strong>42 CFR 493.15(e)(1):</strong>{" "}&ldquo;Follow the
            manufacturer&apos;s instructions for performing the test.&rdquo;
            That&apos;s the whole federal quality requirement for a waived
            test.
          </div>
          <p>
            CLIA doesn&apos;t specify a control frequency, a QC schedule, or
            an acceptable range for a waived test — the manufacturer does,
            in the package insert. A rule that says &ldquo;run a control
            once a week&rdquo; is real, and it&apos;s binding — it&apos;s
            just not coming from CLIA. It&apos;s coming from the box the
            strips shipped in.
          </p>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">
            When to run a control, beyond the schedule
          </h2>
          <p>
            Whatever interval the insert specifies, plus a control run for
            each of these, because each one is a reason the last passing
            control no longer tells you anything about today&apos;s strip:
          </p>
          <ul className="guide-list">
            <li>
              <strong>A new strip lot.</strong>{" "}Manufacturing varies lot to
              lot; a control passed on the old lot says nothing about the
              new one.
            </li>
            <li>
              <strong>A new shipment,</strong>{" "}even of the same lot —
              shipping and storage conditions in transit are outside the
              manufacturer&apos;s control.
            </li>
            <li>
              <strong>A new operator.</strong>
            </li>
            <li>
              <strong>A result that doesn&apos;t fit the patient</strong>{" "}—
              the test disagreeing with the clinical picture is itself a
              reason to question the strip before trusting the result.
            </li>
          </ul>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">
            The half nobody quality-checks: the strips themselves
          </h2>
          <p>
            A reagent strip analyzer reads what the strip did and reports
            it — it has no way to know the strip itself was already
            compromised. Strip pads oxidize on contact with air and
            humidity, so a bottle left open, a missing desiccant packet, or
            a pad that&apos;s already started to discolor produces a result
            that&apos;s wrong in a way the machine cannot detect and will
            not flag.
          </p>
          <p>
            Checking the bottle — desiccant present, cap closed promptly
            after each strip, no discoloration against an unused strip
            — is not housekeeping. For a waived test, it&apos;s the only
            check that exists on the input at all.
          </p>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">
            &ldquo;Not run&rdquo; is a real, recordable answer
          </h2>
          <p>
            Sometimes a control genuinely wasn&apos;t run. A form that
            can&apos;t record that forces an invented &ldquo;in range&rdquo;
            instead — which is worse than an honest gap, because it looks
            clean. A monthly QC record showing both controls skipped and
            filed as passing is exactly the hollow record an audit exists
            to catch; one line saying why the control wasn&apos;t run is a
            better answer every time.
          </p>
        </section>

        <section className="guide-close">
          <h2 className="guide-h2">
            {PRODUCT_NAME}{" "}asks for the lot, the bottle, and the reason
          </h2>
          <p>
            Not just &ldquo;pass&rdquo; or &ldquo;fail&rdquo; — the strip
            lot, when the bottle was opened, whether the desiccant&apos;s
            still there, and which analyte was off when something
            isn&apos;t. That&apos;s the record that actually answers a
            surveyor&apos;s next question.
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

import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata = {
  title: `OSHA sharps injury log requirements, explained — ${PRODUCT_NAME}`,
  description:
    "What 29 CFR 1910.1030(h)(5) actually requires of a sharps injury log at an urgent care clinic: what to record, what to leave out, and how long to keep it.",
};

// Every claim on this page traces to the same citation this product's
// own sharps-injury template carries — see the 'sharps-injury' template
// in supabase/staff-statutory-logs.sql. Written for a search result
// rather than for the app, but the underlying fact never differs
// between the two: it would be a bug in one of them if it did.
export default function SharpsInjuryLogGuide() {
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
            29 CFR 1910.1030(h)(5)
          </span>
          <h1 className="lp-h1 guide-h1">
            The OSHA sharps injury log, explained
          </h1>
          <p className="lp-lede">
            One of the most reliably-cited findings in an OSHA inspection of
            a clinical setting, because a sharps injury log either exists or
            it doesn&apos;t — there is no partial credit.
          </p>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">Who this applies to</h2>
          <p>
            Any employer with employees who have occupational exposure to
            blood or other potentially infectious materials — which covers
            essentially every urgent care, primary care, dental, and
            ambulatory surgery practice — must establish and maintain a
            sharps injury log under the Bloodborne Pathogens Standard.
          </p>
          <p>
            <strong>
              The log has to exist before an injury happens, not after.
            </strong>{" "}
            &ldquo;We&apos;ve never had a needlestick&rdquo; is not an
            exemption — it just means the log has no entries yet. A surveyor
            asking to see it is asking whether the mechanism exists, not
            whether it has been used.
          </p>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">What has to be recorded</h2>
          <ul className="guide-list">
            <li>
              <strong>The type and brand of device involved</strong>{" "}— the
              regulation specifically asks for this, because it&apos;s what
              lets a clinic notice a pattern: three injuries from the same
              lancet brand is a purchasing decision, not three unrelated
              incidents.
            </li>
            <li>
              <strong>The department or work area</strong>{" "}where it happened.
            </li>
            <li>
              <strong>
                An explanation of how the incident occurred
              </strong>{" "}
              — the task in progress and the mechanism, not a narrative with
              names in it.
            </li>
          </ul>

          <div className="guide-callout">
            <strong>The confidentiality requirement is explicit.</strong>{" "}The
            standard requires the log be maintained &ldquo;in such manner as
            to protect the confidentiality of the injured employee.&rdquo;
            The safest way to do that is to never collect a name on the log
            in the first place — there&apos;s no confidentiality control to
            get wrong on a field that was never filled in.
          </div>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">Two things people get wrong</h2>
          <ul className="guide-list">
            <li>
              <strong>Recording a name.</strong>{" "}It feels natural to log who
              was hurt. The regulation asks you not to make that
              identifiable on the record — track it separately, not on the
              sharps log itself.
            </li>
            <li>
              <strong>Treating it as optional below a certain size.</strong>{" "}
              The Bloodborne Pathogens Standard turns on whether any
              employee has occupational exposure, not on headcount — a
              two-provider clinic is covered the same as a large one.
            </li>
          </ul>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">Retention</h2>
          <p>
            Sharps injury log entries are employee exposure and medical
            records, retained for the duration of employment plus 30 years
            under 29 CFR 1910.1020(d) — the general OSHA recordkeeping
            standard for exposure records. That&apos;s a long time to trust a
            binder in a back office.
          </p>
        </section>

        <section className="guide-block">
          <h2 className="guide-h2">The related record</h2>
          <p>
            A sharps injury is also a triggering event for a{" "}
            <strong>post-exposure evaluation</strong>{" "}under 29 CFR
            1910.1030(f)(3) — a confidential medical evaluation and
            follow-up, made available immediately at no cost to the
            employee. The sharps log and the post-exposure evaluation are
            two different, related records; a clinic needs both, not one in
            place of the other.
          </p>
        </section>

        <section className="guide-close">
          <h2 className="guide-h2">
            {PRODUCT_NAME}{" "}files this the same way, on a phone
          </h2>
          <p>
            One entry per injury, no name field, timestamped the moment
            it&apos;s filed rather than reconstructed later from memory —
            which is also the property a surveyor is actually checking for
            when they ask to see the log.
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

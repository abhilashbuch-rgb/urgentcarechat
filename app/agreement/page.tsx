import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import { PRODUCT_NAME, OPERATOR, contactMailto } from "@/lib/site";

export const metadata = {
  title: `Subscription Agreement — ${PRODUCT_NAME}`,
  description: `The agreement a clinic accepts when starting a ${PRODUCT_NAME} trial or subscription — separate from the patient-facing chat's Terms of Service.`,
};

// THE AGREEMENT FOR THE PRODUCT CLINICS ACTUALLY PAY FOR. /terms is the
// old patient-facing triage chat's ToS and stays scoped to that — a
// clinic owner signing up on /start is agreeing to something else
// entirely, and had nothing to actually agree to until this page and
// the checkbox in TrialForm.tsx existed. See supabase/staff-agreement.sql
// for how acceptance is recorded, not just displayed: staff.orgs carries
// agreement_accepted_at, set once at signup by provision_trial(), which
// now refuses to create an org at all without it.
//
// SAME HONESTY AS /terms. Not attorney-reviewed. A checkbox that links
// to something inaccurate is worse than no checkbox — it manufactures
// the appearance of consent to terms nobody actually vetted.
export default function AgreementPage() {
  return (
    <div className="legal-page">
      <header className="site-header">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          <BrandLockup />
        </Link>
      </header>

      <main className="legal-main">
        <div className="legal-draft-banner">
          <strong>Draft — not final.</strong> This page has not been
          reviewed by an attorney. It is a starting point, not a finished
          legal document — liability-limitation, indemnification, and
          dispute-resolution language in particular need professional
          drafting before this is relied on as a real contract.
        </div>

        <h1 className="legal-title">Subscription Agreement</h1>
        <p className="legal-updated">Last updated: [DATE]</p>

        <section className="legal-section">
          <h2>1. Who this is between</h2>
          <p>
            This agreement is between {OPERATOR}{" "}
            (&quot;we,&quot; &quot;us&quot;) and the clinic starting a{" "}
            {PRODUCT_NAME}{" "}
            trial or subscription (&quot;you,&quot; &quot;your clinic&quot;).
            It covers the staff compliance product at{" "}
            <Link href="/staff/signin">your clinic&apos;s staff sign-in</Link>{" "}
            — not the free patient symptom chat on the public site, which
            has its own{" "}
            <Link href="/terms">Terms of Service</Link>.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. The service</h2>
          <p>
            {PRODUCT_NAME}{" "}
            is compliance recordkeeping software: shift logs,
            temperature and equipment checks, staff credentialing, and the
            records a surveyor asks to see. It is not medical advice, does
            not practice medicine, and is not a substitute for your
            clinic&apos;s own clinical judgment or regulatory obligations —
            it is the record of what your clinic already does.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Fees and term</h2>
          <p>
            New clinics get a 30-day trial with no card required. After the
            trial, the subscription is $149 per clinic per month, or $1,490
            per clinic per year paid up front. Each additional clinic under
            the same owner is billed the same way — there is no volume
            discount, because a second clinic is a second full set of logs,
            alarms, and inspections rather than something that costs us
            less to run.
          </p>
          <p>
            You can stop paying at any time. If a subscription lapses, your
            clinic&apos;s workspace goes read-only rather than being deleted
            or locked away — everything already recorded stays visible and
            exportable. We do not hold your compliance records hostage to a
            billing dispute.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. Location data on logs</h2>
          <p>
            Every log your staff files carries the coordinates the device
            reported at that moment, the accuracy the device claimed, and
            the computed distance from your clinic&apos;s address — this is
            a geolocation stamp on the record, used to flag a filing made
            away from the clinic and to show you the distance and the
            reason given.
          </p>
          <p>
            <strong>
              This is not a geofence, and we do not represent it as one.
            </strong>{" "}
            Browser and device location can be spoofed by anyone who wants
            to — through browser developer tools, mock-location apps, or
            simply by turning location off — and nothing on our server can
            reliably tell a spoofed reading from a real one. So a log filed
            away from the clinic is still accepted and still saved; it is
            never silently blocked, and we make no promise that filing from
            outside the clinic is prevented. The record is the deterrent,
            not an access control.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Your data</h2>
          <p>
            Your compliance records belong to your clinic. You can export
            them at any time from inside the app, and a lapsed subscription
            does not restrict that. See our{" "}
            <Link href="/privacy">Privacy Policy</Link> and{" "}
            <Link href="/security">Security &amp; compliance</Link>{" "}
            page for what we collect, what we don&apos;t, and who else can
            see it.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. No warranty; limitation of liability</h2>
          <p>
            The service is provided &quot;as is.&quot; {OPERATOR}{" "}
            disclaims all warranties to the fullest extent permitted by
            law. {PRODUCT_NAME}{" "}
            helps your clinic keep an accurate record — it does not verify
            that your clinic&apos;s underlying practices
            meet any particular regulation, and compliance with applicable
            law remains your clinic&apos;s responsibility. [Placeholder —
            liability caps, indemnification, and dispute-resolution terms
            require attorney drafting specific to your state and business
            structure.]
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Changes</h2>
          <p>
            We may update this agreement from time to time. Continued use
            of the service after a change means you accept the updated
            terms.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Contact</h2>
          <p>
            <a href={contactMailto("Question about the Subscription Agreement")}>
              Email us
            </a>{" "}
            with any question about this agreement.
          </p>
        </section>

        <p className="legal-links">
          <Link href="/privacy">Privacy Policy</Link> ·{" "}
          <Link href="/security">Security</Link> ·{" "}
          <Link href="/terms">Patient chat Terms of Service</Link> ·{" "}
          <Link href="/start">Back to sign up</Link>
        </p>
      </main>
    </div>
  );
}

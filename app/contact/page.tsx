import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import type { Metadata } from "next";
import { PRODUCT_NAME, CONTACT_EMAIL, contactMailto } from "@/lib/site";

export const metadata: Metadata = {
  title: `Contact — ${PRODUCT_NAME}`,
  description:
    "Reach a person about a trial, a live clinic, a security question, or an enterprise agreement.",
  robots: { index: true, follow: true },
};

// A CONTACT PAGE, NOT A CONTACT FORM.
//
// A form on a page like this is a promise that somebody is watching a
// queue. Right now the queue is one person's inbox, and a form would
// hide that behind a "thanks, we'll be in touch" screen that says
// nothing about when. An address the visitor can see, copy and put in
// their own sent folder is more honest and — for a buyer deciding
// whether this company will still exist in a year — more reassuring.
//
// It is also less to break: no endpoint, no spam handling, no silent
// failure where a submission goes nowhere and neither side knows.
//
// The routes are split by what the sender needs back, because "how fast
// will you answer" has a different true answer for a sales question than
// for a clinic whose fridge alarm is not arriving.

const ROUTES = [
  {
    subject: "A clinic is live and something is wrong",
    heading: "Something is broken in a live clinic",
    body:
      "Logs won't file, an alert didn't arrive, or somebody can't sign in. Say which clinic and roughly when it started — that is usually enough to find it in the logs without you having to reproduce anything.",
    urgency: "Fastest route. Put the clinic name in the subject line.",
  },
  {
    subject: "Question before starting a trial",
    heading: "Deciding whether this fits",
    body:
      "What it does and does not cover, what your staff would actually have to do each shift, and what it costs. Happy to say plainly where it is not a fit — a clinic that leaves in month two costs us both more than the one that never started.",
    urgency: "Usually same day.",
  },
  {
    subject: "Security or data question",
    heading: "Security, data and retention",
    body:
      "Where records live, who can read them, what happens when you leave, and what we do not store. Most of it is written down already — the security page is the faster answer if you would rather not wait.",
    urgency: "Answered in writing, so it can go to your compliance file.",
  },
  {
    subject: "Multiple sites or an enterprise agreement",
    heading: "More than one site",
    body:
      "Several clinics on one contract, a BAA against your template, SSO against your directory. That is a conversation rather than a signup form, and some of it is genuinely not built yet.",
    urgency: "Start on the enterprise page — it says what is and is not ready.",
  },
] as const;

export default function ContactPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/">
            <BrandLockup />
          </Link>
          <nav className="lp-nav-links">
            <a href="/demo">See a live demo</a>
            <a href="/staff/signin">Sign in</a>
          </nav>
        </div>
      </header>

      <main className="lp-main">
        <section className="ct-head">
          <h1 className="mh-h2">Talk to a person</h1>
          <p className="ct-lede">
            One address, read by a human. Pick whichever line below matches
            what you need and the subject arrives pre-filled &mdash; it is
            the only thing that decides how quickly it gets answered.
          </p>
          <p className="ct-addr">
            <a href={contactMailto("Hello")}>{CONTACT_EMAIL}</a>
          </p>
        </section>

        <section className="ct-grid">
          {ROUTES.map((r) => (
            <div className="ct-card" key={r.subject}>
              <h2 className="ct-card-h">{r.heading}</h2>
              <p className="ct-card-b">{r.body}</p>
              <p className="ct-card-u">{r.urgency}</p>
              <a className="ct-card-go" href={contactMailto(r.subject)}>
                Email about this &rarr;
              </a>
            </div>
          ))}
        </section>

        <section className="ct-foot">
          {/* SAYING WHO IS BEHIND IT. A compliance product asks a clinic
              to put its inspection evidence somewhere. "A company" is not
              an answer to "who are you" — and a buyer who cannot tell
              whether there is one person or forty behind a product will
              assume the worst number. */}
          <h2 className="ct-foot-h">Who you are writing to</h2>
          <p className="ct-foot-b">
            {PRODUCT_NAME} is a small team, and mail to the address above
            reaches it directly rather than a ticketing queue. If you need
            something in writing for a compliance file &mdash; where data
            is held, what is retained, what happens to your records if you
            stop paying &mdash; say so and you will get it in writing.
          </p>
          <p className="ct-foot-b">
            Not the right page?{" "}
            <Link href="/security">Security and data</Link> answers most
            questions about storage and retention.{" "}
            <Link href="/enterprise">Enterprise</Link> covers multiple
            sites. <Link href="/demo">The demo</Link> needs no account and
            no conversation at all.
          </p>
        </section>
      </main>
    </div>
  );
}

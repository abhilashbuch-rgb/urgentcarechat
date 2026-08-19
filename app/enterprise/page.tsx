import type { Metadata } from "next";
import Link from "next/link";
import BrandIcon from "@/app/components/BrandIcon";
import Wordmark from "@/app/components/Wordmark";
import { contactMailto, PRODUCT_NAME } from "@/lib/site";

// The enterprise door.
//
// A MAILTO, NOT A FORM, and deliberately. A form needs somewhere to put
// what it captures, and there is no admin screen to read a leads table —
// so it would be a write-only queue nobody opens, which is worse than no
// form because the sender believes they have been heard. The mailto goes
// to an inbox a person actually reads, with the questions pre-filled so
// the first reply can be useful rather than a list of things we forgot to
// ask. When there is a CRM, this becomes a form.
//
// WHAT THIS PAGE DOES NOT DO is promise Joint Commission tracers, SSO or
// a signed BAA as though they exist today. They do not. It says what the
// product is, what a large network would additionally need, and that
// those are a conversation — because the first enterprise prospect who
// discovers a promised feature is not built is also the last.

export const metadata: Metadata = {
  title: `Enterprise — ${PRODUCT_NAME}`,
  description:
    "Compliance logging for hospital outpatient networks and multi-site groups.",
  alternates: { canonical: "/enterprise" },
};

const SUBJECT = "Enterprise enquiry";

const BODY_PROMPTS = [
  "Organisation:",
  "Number of sites, and what kind (urgent care, primary care, ASC, dental, other):",
  "Roughly how many staff across all sites:",
  "Are you accredited, and by whom (TJC, AAAHC, DNV, state only):",
  "Do you need SSO, and against what (Entra, Okta, other):",
  "Do you require a signed BAA before evaluation:",
  "Anything an evaluation would have to prove:",
];

const WHAT_YOU_GET = [
  "Every log, alarm, report and export described on the main site",
  "One clinic record per site, each with its own logs and its own inspection link",
  "One login across all of your sites, with a per-site role",
  "Scheduled log reports to whoever should receive them, at whatever cadence",
];

const WHAT_WE_TALK_ABOUT = [
  "Single sign-on against your identity provider",
  "A signed business associate agreement, and your security review",
  "Accreditation frameworks other than the urgent-care binder this ships with",
  "Roll-up reporting across sites, and who in your organisation may see across them",
  "Term, invoicing and purchase-order billing instead of a card",
];

export default function EnterprisePage() {
  return (
    <div className="lp lp-min">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/">
            <BrandIcon />
            <Wordmark />
          </Link>
          <nav className="lp-nav-links">
            <a href="/demo">See a live demo</a>
            <a href="/staff/signin">Sign in</a>
          </nav>
        </div>
      </header>

      <main className="lp-main tr-main">
        <div className="tr-card ent-card">
          <h1 className="tr-h1">Enterprise</h1>
          <p className="tr-lede">
            A single clinic can sign up and be running this afternoon. A
            hospital outpatient network or a large group usually cannot, and
            it is better to say why than to sell you a card checkout you
            would have to unpick.
          </p>

          <h2 className="ent-h2">What is ready today</h2>
          <ul className="ent-list">
            {WHAT_YOU_GET.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>

          <h2 className="ent-h2">What we would need to work out</h2>
          <p className="ent-note">
            These are honestly not built yet. That is the conversation.
          </p>
          <ul className="ent-list">
            {WHAT_WE_TALK_ABOUT.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>

          <a
            className="st-primary ent-cta"
            href={contactMailto(SUBJECT)}
          >
            Email us about your network
          </a>

          <p className="ent-prompts-intro">
            It speeds things up if your first message covers:
          </p>
          <ul className="ent-prompts">
            {BODY_PROMPTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>

          <p className="tr-fine">
            If you are a single clinic — urgent care, primary care, medical
            spa, surgery center or dental — you do not need this page.{" "}
            <Link href="/start">Start a trial</Link> instead; it is $149 a
            month per clinic and takes about a minute.
          </p>
        </div>
      </main>
    </div>
  );
}

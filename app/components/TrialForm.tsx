"use client";

import { useState } from "react";
import Link from "next/link";
import { contactMailto } from "@/lib/site";
import InstallPrompt from "@/app/components/staff/InstallPrompt";

// Two fields and one choice, because that is what it takes. Asking for a
// phone number or a clinic size here would cost more signups than the
// data is worth.
//
// THE TYPE IS ASKED BECAUSE IT CHANGES THE PRODUCT, not because it is
// useful to know. It decides which logs the clinic opens with — a med
// spa has no narcotics count, a primary care has no lead aprons — and
// the alternative is every clinic starting with an urgent care's board
// and deleting what does not apply. Defaulted, so somebody who ignores
// it still gets a working workspace.
const FACILITIES: { id: string; label: string; hint: string }[] = [
  { id: "urgent_care", label: "Urgent care", hint: "Crash cart, X-ray, POCT, narcotics" },
  { id: "primary_care", label: "Primary care or pediatrics", hint: "VFC vaccine storage, POCT" },
  { id: "med_spa", label: "Medical spa", hint: "Injectable lots, laser safety, autoclave" },
  { id: "ambulatory_surgery", label: "Surgery center", hint: "MH cart, sterile processing, narcotics" },
  { id: "dental", label: "Dental or oral surgery", hint: "Spore testing, sedation, amalgam" },
];

export default function TrialForm({
  demoConfig,
  demoFacility,
}: {
  /** The configuration string from a demo the visitor just walked
   *  through, or undefined for somebody arriving cold. Carried so the
   *  two choices they already made are not asked again — and shown, not
   *  applied silently, so nobody signs up for a shape they did not
   *  realise had been selected for them. */
  demoConfig?: string;
  demoFacility?: string | null;
} = {}) {
  const [clinic, setClinic] = useState("");
  const [email, setEmail] = useState("");
  const [facility, setFacility] = useState(demoFacility ?? "urgent_care");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !agreed) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/trial", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinic: clinic.trim(),
        email: email.trim(),
        facility,
        // Only sent when the facility still matches the one the demo was
        // configured for. Changing "urgent care" to "med spa" on this
        // screen makes a lead-apron choice meaningless, and carrying it
        // anyway would switch on a log for equipment they just said they
        // do not have.
        demo: demoFacility && facility === demoFacility ? demoConfig : undefined,
        agreed,
      }),
    }).catch(() => null);

    if (!res?.ok) {
      setBusy(false);
      // Already onboarded. The clinic name comes back so the message can
      // say which one, because "ask your administrator" is useless to
      // somebody who does not yet know a workspace exists.
      if (res?.status === 409) {
        const body = await res.json().catch(() => null);
        setError(
          body?.clinic
            ? `taken:${body.clinic}`
            : "taken:your clinic"
        );
        return;
      }
      setError(
        res?.status === 400
          ? "Check the clinic name and email address."
          : res?.status === 503
            // Not the visitor's fault, and saying "try again" would send
            // them round a loop that cannot succeed. Name the situation
            // and give them a way to reach a person.
            ? "notopen"
            : "That didn't go through. Try again."
      );
      return;
    }
    setDone(email.trim());
  }

  if (done) {
    return (
      <div className="tr-done">
        <h2>Your workspace is ready.</h2>
        <p>
          Sign in as <strong>{done}</strong> &mdash; with Google if that
          address is on Google Workspace, or with the emailed six-digit code
          otherwise. That address is the administrator; any other account
          will be turned away.
        </p>
        <a className="lp-btn-primary" href="/staff/signin">
          Sign in and set it up
        </a>
        <p className="tr-fine">
          30 days, no card. When it ends nothing is deleted — the workspace
          goes read-only and everything stays exportable.
        </p>
        {/* OFFERED HERE AND NOWHERE ELSE ON THE MARKETING SITE.
            A prospect reading pricing on a laptop has no use for a
            home-screen icon. The person on this screen has just created
            a clinic and is the account's first user — very often on the
            phone they will file from every morning — so this is the one
            moment before sign-in where the suggestion is earned. It is
            still a dismissible banner, and still silent on any platform
            where the instruction would not be true. */}
        <InstallPrompt />
      </div>
    );
  }

  return (
    <form className="tr-form" onSubmit={submit}>
      <label className="st-field">
        <span className="st-field-label">Clinic name</span>
        <input
          className="st-input"
          value={clinic}
          onChange={(e) => setClinic(e.target.value)}
          placeholder="e.g. Riverside Urgent Care"
          autoFocus
        />
      </label>
      <fieldset className="tr-fac">
        <legend className="st-field-label">What kind of clinic</legend>
        <div className="tr-fac-grid">
          {FACILITIES.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`tr-fac-card${facility === f.id ? " tr-fac-on" : ""}`}
              aria-pressed={facility === f.id}
              onClick={() => setFacility(f.id)}
            >
              <span className="tr-fac-label">{f.label}</span>
              <span className="tr-fac-hint">{f.hint}</span>
            </button>
          ))}
        </div>
        <span className="st-field-hint">
          This picks the logs you start with. You can add or remove any of
          them afterwards, and add more clinics of other kinds later.
        </span>
        {/* THE SIXTH DOOR IS A LINK, NOT A SIXTH CHOICE.
            A hospital or a multi-site system cannot be served by this
            form: it needs a BAA negotiated against their template, a
            security review, SSO against their directory, and a contract
            that is not $149 on a card. Putting it in the picker would
            take their card details and hand them a single-clinic
            workspace they cannot legally put staff into. So it is
            labelled as what it is and it goes somewhere a person
            answers. */}
        <a className="tr-fac-more" href="/enterprise">
          <span className="tr-fac-label">Hospital or health system?</span>
          <span className="tr-fac-hint">
            Several sites on one contract, with a BAA and your own SSO
            &mdash; that is a conversation, not a signup form. Talk to us
            about enterprise terms &rarr;
          </span>
        </a>
      </fieldset>

      <label className="st-field">
        <span className="st-field-label">Your email</span>
        <input
          className="st-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@clinic.com"
          autoComplete="email"
        />
        <span className="st-field-hint">
          You&rsquo;ll sign in as this address afterward &mdash; with Google
          if it&rsquo;s a Google account, or with an emailed code if not.
          {" "}
          {/* NOT "work email". The person filling in this form is the owner
              paying for the clinic, and plenty of them run the practice off
              a Gmail address. Asking for a work email either turns them
              away or gets them to invent one they never check — and the
              address they enter here is the one every alert and every
              billing notice goes to. */}
          A personal address is fine; it is the one you will be signing in
          with, so use whichever inbox you actually read.
        </span>
      </label>

      {/* THE ONE THING A CHECKBOX HAS TO ACTUALLY DO: gate the button.
          A checkbox that renders but doesn't block submission is a
          decoration, not consent — see supabase/staff-agreement.sql,
          which refuses to create an org at all without this reaching
          the server as true. */}
      <label className="tr-agree">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>
          I agree to the{" "}
          <Link href="/agreement" target="_blank" rel="noopener noreferrer">
            Subscription Agreement
          </Link>
          , including how location data on a log is used.
        </span>
      </label>

      {error?.startsWith("taken:") ? (
        <p className="st-sign-error" role="alert">
          <strong>{error.slice(6)} already has a workspace.</strong>{" "}
          Staff don&rsquo;t sign up here &mdash; an administrator adds you,
          and then you sign in. Ask whoever runs your clinic to invite this
          address, then use{" "}
          <a href="/staff/signin">the staff sign-in</a>.
        </p>
      ) : error === "notopen" ? (
        <p className="st-sign-error" role="alert">
          Self-serve signup isn&rsquo;t switched on yet &mdash; that&rsquo;s on
          us, not you.{" "}
          <a href={contactMailto("Set up my clinic")}>
            Email us and we&rsquo;ll set your clinic up by hand.
          </a>
        </p>
      ) : error === "agreement_not_accepted" ? (
        <p className="st-sign-error" role="alert">
          Check the Subscription Agreement box above to continue.
        </p>
      ) : (
        error && (
          <p className="st-sign-error" role="alert">
            {error}
          </p>
        )
      )}

      <button className="st-primary" type="submit" disabled={busy || !agreed}>
        {busy ? "Setting up…" : "Start the 30-day trial"}
      </button>
      <p className="tr-fine">No credit card. Nothing to cancel.</p>
    </form>
  );
}

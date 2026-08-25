import type { Metadata } from "next";
import Link from "next/link";
import DemoBanner from "@/app/components/demo/DemoBanner";
import DemoShift from "@/app/components/demo/DemoShift";
import { decodeConfig, listPhrase } from "@/lib/demo/config";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Demo: a shift — ${PRODUCT_NAME}`,
  robots: { index: false, follow: true },
};

// The board the wizard's choices produce.
//
// THE CONFIG TRAVELS IN THE URL. There is no session here to hold it and
// no database to write it to — that is the demo's whole safety property.
// A query string also means the salesperson can send somebody the exact
// board they configured on a call, which a server-side session could not
// do without becoming an account.

export default async function DemoToday({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const { archetype, on } = decodeConfig(c);
  const active = archetype.modules.filter((m) => on.has(m.key));

  return (
    <div className="st-page st-page-narrow">
      <DemoBanner role="medical assistant" />
      <header className="st-page-head">
        <h1 className="st-h1">Today</h1>
        <p className="st-page-sub">
          {archetype.label}
          {" \u00b7 "}
          signed in as dana@sample-clinic.com
        </p>
      </header>

      {/* Says which of their choices is visible and which is not, because
          a board that quietly omits something reads as a board that
          forgot it. */}
      <div className="demo-config-note">
        <strong>Your configuration</strong>
        <span>
          {active.length > 0
            ? `${active.map((m) => m.label).join(", ")} — on. `
            : "Nothing optional switched on. "}
          {archetype.modules
            .filter((m) => !on.has(m.key))
            .map((m) => m.label)
            .join(", ")}
          {archetype.modules.some((m) => !on.has(m.key)) &&
            " — off, so they are not on this board at all."}
        </span>
        <Link href="/demo" className="demo-config-change">
          Change it
        </Link>
      </div>

      <DemoShift extras={active.map((m) => ({ key: m.key, name: m.label }))} />

      {/* THE OFFER, AFTER THE THING RATHER THAN BEFORE IT.
          No modal, no interstitial, nothing that has to be dismissed to
          keep looking around. Somebody who wants to file six sample logs
          and leave should be able to, and somebody who has decided
          should not have to redo the two choices they just made. The
          honest version of "convert" is a link at the bottom that
          remembers. */}
      <section className="demo-convert">
        <h2 className="demo-convert-h">Start with this setup</h2>
        <p className="demo-convert-b">
          Your clinic would be created as {archetype.phrase} with{" "}
          {active.length > 0
            ? `${listPhrase(active.map((m) => m.label.toLowerCase()))} switched on`
            : "nothing optional switched on"}
          , plus everything required. You still enter the clinic name and
          your email, and you can change any of it on the next screen or
          afterwards.
        </p>
        <Link className="st-primary demo-convert-go" href={`/start?c=${encodeURIComponent(c ?? "")}`}>
          Set this up for real &mdash; 30 days, no card
        </Link>
        <p className="demo-convert-foot">
          Or keep looking: <Link href="/demo">change the setup</Link>,{" "}
          <Link href="/demo/surveyor">see the inspection view</Link>, or{" "}
          <Link href="/contact">ask a question first</Link>.
        </p>
      </section>
    </div>
  );
}

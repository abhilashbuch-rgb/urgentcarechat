import type { Metadata } from "next";
import Link from "next/link";
import DemoBanner from "@/app/components/demo/DemoBanner";
import DemoShift from "@/app/components/demo/DemoShift";
import { decodeConfig } from "@/lib/demo/config";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Demo: a shift — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
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
    </div>
  );
}

import type { Metadata } from "next";
import DemoBanner from "@/app/components/demo/DemoBanner";
import DemoLogRunner from "@/app/components/demo/DemoLogRunner";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Demo: shift check — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

export default function DemoToday() {
  return (
    <div className="st-page st-page-narrow">
      <DemoBanner role="medical assistant" />
      <header className="st-page-head">
        <h1 className="st-h1">Today&rsquo;s shift check</h1>
        <p className="st-page-sub">
          Tap a preset instead of typing a number &mdash; the reading is
          still a real tap against the actual thermometer, not a default
          nobody looked at.
        </p>
      </header>
      <DemoLogRunner />
    </div>
  );
}

import type { Metadata } from "next";
import DemoBanner from "@/app/components/demo/DemoBanner";
import DemoShift from "@/app/components/demo/DemoShift";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Demo: a medical assistant's shift — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

// WHAT THIS SCREEN USED TO BE. A log form, titled "Today's shift check".
// It showed the one genuinely good thing about the product — a reading
// entered with one tap — and skipped everything around it, so an
// evaluator saw a nice input control and had to take the rest on trust.
//
// The real Today screen is now the answer to two questions a medical
// assistant has at seven in the morning: how much is left, and what is
// next. That is what a buyer should see first, because it is the
// difference between a compliance binder and a shift.

export default function DemoToday() {
  return (
    <div className="st-page st-page-narrow">
      <DemoBanner role="medical assistant" />
      <header className="st-page-head">
        <h1 className="st-h1">Today</h1>
        <p className="st-page-sub">
          Signed in as dana@sample-clinic.com &middot; Staff
        </p>
      </header>
      <DemoShift />
    </div>
  );
}

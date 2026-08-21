import BrandLockup from "@/app/components/BrandLockup";
import type { Metadata } from "next";
import Link from "next/link";
import TrialForm from "@/app/components/TrialForm";
import { PRODUCT_NAME } from "@/lib/site";
import {
  ARCHETYPES,
  facilityFromConfig,
  modulesFromConfig,
  ALL_MODULES,
  listPhrase,
} from "@/lib/demo/config";

export const metadata: Metadata = {
  title: `Start a trial — ${PRODUCT_NAME}`,
  description:
    "Fourteen days, no credit card. Set up your clinic's compliance workspace in about a minute.",
  robots: { index: true, follow: true },
};

export default async function StartTrial({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  // Somebody arriving from a demo they just configured. Everything below
  // still works without it — this is a shortcut, never a funnel, and
  // there is no version of this page that only opens with a config.
  const { c } = await searchParams;
  const demoFacility = facilityFromConfig(c);
  const archetype = ARCHETYPES.find((a) => a.key === demoFacility) ?? null;
  const on = modulesFromConfig(c).filter((m) => m.on);
  const off = modulesFromConfig(c).filter((m) => !m.on);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link className="lp-brand" href="/">
            <BrandLockup />
          </Link>
          <nav className="lp-nav-links">
            <a href="/staff/signin">Sign in</a>
          </nav>
        </div>
      </header>

      <main className="lp-main tr-main">
        <div className="tr-card">
          {/* WHO THIS SCREEN IS FOR, SAID FIRST. The old heading was
              "Start your clinic's trial", which reads as an invitation to
              everybody who works at a clinic — including the medical
              assistant whose clinic already has a workspace. Two doors
              only work if each one says which it is. */}
          <p className="tr-eyebrow">For clinic owners and administrators</p>
          <h1 className="tr-h1">Set up your clinic</h1>
          <p className="tr-lede">
            Two fields, then sign in &mdash; with Google or with an emailed
            code, whichever your inbox is on. Your logs are ready to run the
            same day.
          </p>
          <p className="tr-lede tr-lede-alt">
            Already work somewhere that uses this? You don&rsquo;t sign up
            &mdash; your administrator invites you, then you{" "}
            <Link href="/staff/signin">sign in here</Link>.
          </p>
          {/* SAID OUT LOUD, NOT APPLIED QUIETLY. A form that arrives
              pre-filled from a previous screen is helpful; one that
              arrives pre-filled without saying so is a form somebody
              submits without reading. This names every choice carried
              over and every one switched off, and the picker below is
              live either way. */}
          {archetype && (
            <div className="tr-carried" role="status">
              <strong>Carried over from your demo</strong>
              <span>{carriedSentence(archetype.label, on, off)}</span>
            </div>
          )}
          <TrialForm demoConfig={c} demoFacility={demoFacility} />
        </div>
      </main>
    </div>
  );
}

/**
 * One string, not a row of JSX fragments.
 *
 * Built as fragments this read "Urgent care , with ... switched on , and
 * ... off ." — JSX drops the space before an expression and keeps the
 * one before the punctuation that followed it. A sentence assembled in
 * TypeScript has exactly the spaces it is written with.
 */
function carriedSentence(
  label: string,
  on: { slug: string }[],
  off: { slug: string }[]
): string {
  const parts = [label];
  if (on.length > 0) {
    parts.push(
      `with ${listPhrase(on.map((m) => slugLabel(m.slug)))} switched on`
    );
  }
  if (off.length > 0) {
    parts.push(
      `${on.length > 0 ? "and " : "with "}${listPhrase(
        off.map((m) => slugLabel(m.slug))
      )} off`
    );
  }
  return `${parts.join(", ")}. Change anything below, or afterwards on the settings screen.`;
}

/** The demo's own label for a template slug — the two vocabularies meet
 *  in lib/demo/config.ts and nowhere else. */
function slugLabel(slug: string): string {
  const m = Object.values(ALL_MODULES).find((x) => x.slug === slug);
  return (m?.label ?? slug).toLowerCase();
}

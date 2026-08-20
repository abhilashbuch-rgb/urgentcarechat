import BrandLockup from "@/app/components/BrandLockup";
import Link from "next/link";
import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Live demo — ${PRODUCT_NAME}`,
  description:
    "Walk through the four screens staff actually use, with sample data and no account.",
  robots: { index: false, follow: false },
};

// Four role cards, not five, and not a form. This is the one place in
// the product where picking a role on screen is fine — nobody here is a
// real employee assigning themselves Provider at 6am; they are an
// evaluator deciding which sample screen to look at next, and every
// screen behind these cards is read-only fixture data with no session
// underneath it.
const ROLES = [
  {
    href: "/demo/today",
    emoji: "🩺",
    title: "Medical assistant",
    body: "The 15-second shift check: fridge temps and O2 pressure filled in with one tap, not typed.",
  },
  {
    href: "/demo/learning",
    emoji: "🚨",
    title: "Provider",
    body: "Emergency guides — every step visible at once, nothing to sign, nothing collapsed.",
  },
  {
    href: "/demo/documents",
    emoji: "🪪",
    title: "Any staff member",
    body: "The credential shelf everyone keeps for themselves — BLS, licence, CME, with expiry called out early.",
  },
  {
    href: "/demo/surveyor",
    emoji: "📋",
    title: "Surveyor / owner",
    body: "The read-only inspection vault: 90 days of temperature history and nothing financial in sight.",
  },
] as const;

export default function DemoIndex() {
  return (
    <div className="st-page st-page-narrow demo-index">
      <header className="demo-index-head">
        <Link href="/" className="demo-index-brand">
          <BrandLockup />
        </Link>
        <Link href="/start" className="demo-index-cta">
          Start the real trial
        </Link>
      </header>

      <h1 className="st-h1">See it before you sign up</h1>
      <p className="st-page-sub">
        Four screens, sample clinic, no account. Pick who you want to see it
        as — everything below is fixture data; nothing you tap here is saved
        or sent anywhere.
      </p>

      <div className="demo-role-grid">
        {ROLES.map((r) => (
          <Link key={r.href} href={r.href} className="demo-role-card">
            <span className="demo-role-emoji" aria-hidden="true">
              {r.emoji}
            </span>
            <span className="demo-role-title">{r.title}</span>
            <span className="demo-role-body">{r.body}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

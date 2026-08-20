import BrandLockup from "@/app/components/BrandLockup";
import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Demo: surveyor vault — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

// Mirrors the real, no-session inspector view at app/surveyor/[token] —
// same sections, same tables, fixture rows. That page has no chart on
// it at all; the 90-day temperature curve is a PDF-only page (see
// lib/staff/binder-pdf.ts), which is why the export button below is
// disabled rather than faked.
const TODAY = [
  { name: "Crash cart & AED", slot: "AM", filed: "7:12am", by: "R. Alvarez", flag: false },
  { name: "Refrigerator temperatures", slot: "AM", filed: "7:20am", by: "R. Alvarez", flag: false },
  { name: "Refrigerator temperatures", slot: "PM", filed: null, by: null, flag: false },
  { name: "Controlled substance count", slot: "AM", filed: "7:05am", by: "R. Alvarez", flag: true },
] as const;

const CREDS = [
  { name: "R. Alvarez", kind: "BLS / CPR", expires: "Mar 14, 2027", status: "current" },
  { name: "S. Okafor, RN", kind: "Licence", expires: "Sep 30, 2026", status: "expiring" },
  { name: "T. Nguyen", kind: "ACLS", expires: "Jul 1, 2026", status: "expired" },
] as const;

const OBLIGATIONS = [
  { title: "OSHA 300A posting", due: "Feb 1, 2027", owner: "Center admin", status: "upcoming" },
  { title: "CLIA certificate renewal", due: "Nov 12, 2026", owner: "Medical director", status: "upcoming" },
] as const;

export default function DemoSurveyor() {
  const done = TODAY.filter((t) => t.filed).length;
  const flagged = TODAY.filter((t) => t.flag).length;
  const expired = CREDS.filter((c) => c.status === "expired").length;

  return (
    <div className="sv">
      <header className="sv-top">
        <span className="sv-brand">
          <BrandLockup />
        </span>
        <span className="sv-badge">Demo &middot; inspector view, sample data</span>
      </header>

      <main className="sv-main">
        <h1 className="sv-h1">Sample Urgent Care</h1>
        <p className="sv-sub">
          This is what a surveyor link opens to &mdash; no login, no
          navigation into the app, nothing financial. On a real link this
          expires on a clock the administrator sets; here it&rsquo;s just a
          fixture.
        </p>

        <section className="sv-stats">
          <div className="sv-stat">
            <span className="sv-stat-value">{done} of {TODAY.length}</span>
            <span className="sv-stat-label">Logged today</span>
          </div>
          <div className="sv-stat">
            <span className="sv-stat-value">{flagged}</span>
            <span className="sv-stat-label">Out of range</span>
          </div>
          <div className="sv-stat">
            <span className="sv-stat-value">{expired}</span>
            <span className="sv-stat-label">Expired credentials</span>
          </div>
          <div className="sv-stat">
            <span className="sv-stat-value">{OBLIGATIONS.length}</span>
            <span className="sv-stat-label">Open obligations</span>
          </div>
        </section>

        <section className="sv-section">
          <h2 className="sv-h2">Today&rsquo;s logs</h2>
          <table className="sv-table">
            <thead>
              <tr><th>Task</th><th>Slot</th><th>Filed</th><th>By</th></tr>
            </thead>
            <tbody>
              {TODAY.map((t, i) => (
                <tr key={i}>
                  <td>{t.name}{t.flag && <span className="sv-flag">Out of range</span>}</td>
                  <td>{t.slot}</td>
                  <td>{t.filed ?? "Not yet"}</td>
                  <td>{t.by ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="sv-section">
          <h2 className="sv-h2">Credential currency</h2>
          <table className="sv-table">
            <thead>
              <tr><th>Staff member</th><th>Credential</th><th>Expires</th><th>Status</th></tr>
            </thead>
            <tbody>
              {CREDS.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td>{c.kind}</td>
                  <td>{c.expires}</td>
                  <td><span className={`sv-state sv-state-${c.status}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="sv-section">
          <h2 className="sv-h2">Open obligations</h2>
          <table className="sv-table">
            <thead>
              <tr><th>Obligation</th><th>Due</th><th>Owner</th><th>Status</th></tr>
            </thead>
            <tbody>
              {OBLIGATIONS.map((o, i) => (
                <tr key={i}>
                  <td>{o.title}</td>
                  <td>{o.due}</td>
                  <td>{o.owner}</td>
                  <td><span className={`sv-state sv-state-${o.status}`}>{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <p className="sv-foot">
          This view contains no patient information. The full accreditation
          binder &mdash; including the 90-day temperature curve &mdash;
          exports as a bookmarked PDF from the real vault; disabled here
          since there is no real clinic behind this page to export.
        </p>
        <button className="st-primary" type="button" disabled>
          Export UCA binder (PDF) &mdash; available on your live vault
        </button>

        <p className="demo-surveyor-back">
          <Link href="/demo">&larr; See it as a different role</Link>
        </p>
      </main>
    </div>
  );
}

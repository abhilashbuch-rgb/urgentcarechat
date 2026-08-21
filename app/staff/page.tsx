import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile, outstandingFor } from "@/lib/staff/compliance";
import { summary, type ObligationSummary } from "@/lib/staff/obligations";
import { ROLE_LABELS, atLeast } from "@/lib/staff/roles";
import { shiftState, myCredentialWarnings, type ShiftState, type ExpiringCredential } from "@/lib/staff/shift";

// The staff landing screen — one shift, from the point of view of the
// person working it.
//
// It used to show the org's name, the size of the team, and a row count
// read back through row-level security: a demonstration that the plumbing
// worked, printed on the screen of somebody who came to log a fridge
// temperature before the doors open. What is here now is what they owe
// this shift, one tap to the next of it, and anything expiring that is
// theirs rather than the clinic's.

export const dynamic = "force-dynamic";

interface Overview {
  outstanding: number;
  needsOnboarding: boolean;
  // Null for anyone who cannot open the register — the query is not run
  // at all rather than run and discarded.
  obligations: ObligationSummary | null;
  shift: ShiftState;
  credentials: ExpiringCredential[];
}

export default async function StaffHome() {
  const { session, org } = await requireStaff();

  // Obligations moved off the staff nav: renewing the CLIA certificate is
  // not a medical assistant's job and a register they cannot act on is
  // noise on the one screen that has to stay short. The callouts below
  // follow the nav rather than contradicting it — pointing somebody at a
  // page they were just removed from is worse than not mentioning it.
  const seesObligations = atLeast(session.role, "clinical_lead");

  let overview: Overview | null = null;
  let dbError: string | null = null;

  try {
    overview = await withSession(session, async (sql) => {
      const profile = await getProfile(sql, session.uid);
      const outstanding = await outstandingFor(sql, session.uid);
      return {
        shift: await shiftState(sql, profile?.job_role ?? null),
        credentials: await myCredentialWarnings(sql, session.uid),
        outstanding: outstanding.length,
        needsOnboarding:
          !profile?.esign_consented_at || !profile?.legal_name,
        obligations: seesObligations ? await summary(sql, org) : null,
      };
    });
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown error";
  }

  // First sign-in goes straight into the packet rather than to a
  // dashboard with a notification on it. Someone who has never consented
  // or signed anything has nothing to look at here yet, and a banner they
  // can dismiss is exactly how "we never knew" happens.
  if (overview?.needsOnboarding) redirect("/staff/onboarding");

  return (
    <div className="st-page">
      <header className="st-page-head">
        {/* "Today", not the org name — the header above already says which
            clinic this is, and repeating it here gave the screen two
            headings that said the same thing. Matching the nav item means
            the page title and the tab you clicked agree. */}
        <h1 className="st-h1">Today</h1>
        <p className="st-page-sub">
          Signed in as {session.email} &middot; {ROLE_LABELS[session.role]}
        </p>
      </header>

      {dbError && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>The staff database isn&rsquo;t reachable</strong>
          <span>
            Run <code>supabase/staff-schema.sql</code>, then set{" "}
            <code>STAFF_DATABASE_URL</code> to the <code>staff_app</code> role.
            The sign-in above still worked, so the session and org resolution
            are fine &mdash; only the data layer is missing.
          </span>
          <span className="st-notice-detail">{dbError}</span>
        </div>
      )}

      {overview && overview.outstanding > 0 && (
        <a className="st-callout" href="/staff/onboarding">
          <span className="st-callout-title">
            {overview.outstanding === 1
              ? "1 document is waiting for your signature"
              : `${overview.outstanding} documents are waiting for your signature`}
          </span>
          <span className="st-callout-sub">
            Review and sign them &rarr;
          </span>
        </a>
      )}

      {/* An overdue obligation is the one thing on this screen that is
          already a finding rather than a task. It sits above the cards
          for that reason, and it names the count rather than showing a
          dot, because a dot is something you stop seeing. */}
      {overview?.obligations && overview.obligations.overdue > 0 && (
        <Link className="st-callout st-callout-warn" href="/staff/obligations">
          <span className="st-callout-title">
            {overview.obligations.overdue === 1
              ? "1 obligation is overdue"
              : `${overview.obligations.overdue} obligations are overdue`}
          </span>
          <span className="st-callout-sub">Open the register &rarr;</span>
        </Link>
      )}

      {overview?.obligations &&
        overview.obligations.overdue === 0 &&
        overview.obligations.due_soon > 0 && (
          <Link className="st-callout" href="/staff/obligations">
            <span className="st-callout-title">
              {overview.obligations.due_soon === 1
                ? "1 obligation is due in the next 30 days"
                : `${overview.obligations.due_soon} obligations are due in the next 30 days`}
            </span>
            <span className="st-callout-sub">Open the register &rarr;</span>
          </Link>
        )}

      {/* THE SHIFT, NOT THE ORGANIZATION.
          What stood here was three cards explaining the software to the
          person using it — how the hostname resolves, how row-level
          security scopes a query. True, and written for whoever was
          building this rather than for a medical assistant at seven in
          the morning. */}
      {overview && overview.shift.due + overview.shift.done > 0 && (
        <section className="st-shift">
          <p className="st-shift-count">
            {overview.shift.due === 0
              ? "Everything due this shift is filed."
              : overview.shift.due === 1
                ? "1 check left this shift"
                : `${overview.shift.due} checks left this shift`}
          </p>
          {overview.shift.done > 0 && (
            <p className="st-shift-done">
              {overview.shift.done} already filed
              {overview.shift.flagged > 0 &&
                ` · ${overview.shift.flagged} out of range`}
            </p>
          )}

          {/* One tap to the next one. Today, then Logs, then find the
              row, then open it was four taps before a number could be
              typed — on a screen whose whole claim is fifteen seconds. */}
          {overview.shift.next && (
            <Link
              className="st-primary st-shift-go"
              href={`/staff/logs/${overview.shift.next.slug}${
                overview.shift.next.slot
                  ? `?slot=${overview.shift.next.slot}`
                  : ""
              }`}
            >
              Start: {overview.shift.next.name}
            </Link>
          )}
        </section>
      )}

      {/* THEIRS, NOT THE CLINIC'S.
          The one thing on this screen that serves the person reading it:
          their card, their licence, their problem if it lapses. Silent
          when nothing is approaching, because a permanent green row is
          another thing to stop seeing. */}
      {overview && overview.credentials.length > 0 && (
        <section className="st-mycreds">
          <h2 className="st-h2">Your credentials</h2>
          <ul className="st-mycred-list">
            {overview.credentials.map((c) => (
              <li key={c.kind_label} className={`st-mycred st-mycred-${c.status}`}>
                <span className="st-mycred-kind">{c.kind_label}</span>
                <span className="st-mycred-state">
                  {c.status === "missing"
                    ? "Not on file"
                    : c.status === "expired"
                      ? "Expired"
                      : c.days_left === 1
                        ? "Expires tomorrow"
                        : `Expires in ${c.days_left} days`}
                </span>
              </li>
            ))}
          </ul>
          <Link className="st-mycred-go" href="/staff/documents">
            Update your documents
          </Link>
        </section>
      )}

      <p className="st-foot">
        This area is separate from the patient symptom checker, which stays
        anonymous: no accounts, no records, nothing here connected to it.
      </p>
    </div>
  );
}

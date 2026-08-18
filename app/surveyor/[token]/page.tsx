import type { Metadata } from "next";
import { redeem, asSurveyor } from "@/lib/staff/surveyor";
import { getTenantBySlug } from "@/lib/tenants";
import { formatSignedAt } from "@/lib/staff/labels";
import { KIND_LABELS } from "@/lib/staff/credentials";
import BrandIcon from "@/app/components/BrandIcon";
import Wordmark from "@/app/components/Wordmark";

// The inspector's view. No session, no account, no writes.
//
// WHAT IS DELIBERATELY ABSENT: billing, the team roster's edit controls,
// settings, invitations, the alert configuration, and every button in
// the product. This page renders text. There is no form on it, no API it
// can reach, and no navigation into the staff app — an inspector holding
// this link cannot become a user of the clinic's account.
//
// THE URL IS THE CREDENTIAL, so the token must not travel anywhere:
//   * robots noindex/nofollow, so it is never crawled into an index
//   * Referrer-Policy: no-referrer, set in proxy.ts for this path, so
//     the token is not sent in a Referer header to any outbound link
//   * no external images, fonts or scripts on the page
//
// NOT GATED BY READ-ONLY BILLING. The failure this avoids: a card
// declines, access locks, and a clinic fails a state inspection because
// it cannot show logs it already recorded. A billing dispute must never
// become a regulatory finding.

export const dynamic = "force-dynamic";

// Belt and braces alongside the header in proxy.ts. A surveyor link in a
// search index would be a compliance record in a search index.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function SurveyorView({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ctx = await redeem(token);

  // Expired, revoked, mistyped and never-existed all render the SAME
  // screen. Distinguishing them would turn this page into an oracle that
  // confirms which tokens are real, and the inspector's next step is
  // identical in every case: ask for a new link.
  if (!ctx) return <Expired />;

  const tenant = await getTenantBySlug(ctx.org);
  const orgName = tenant?.displayName ?? ctx.org;

  const data = await asSurveyor(ctx.org, async (sql) => ({
    today: await sql<
      {
        name: string;
        slot: string;
        submitted_at: string | null;
        has_out_of_range: boolean | null;
        submitted_by_name: string | null;
      }[]
    >`
      select name, slot, submitted_at::text as submitted_at,
             has_out_of_range, submitted_by_name
        from staff.todays_logs
       order by sort_order, slot
    `,
    creds: await sql<
      {
        legal_name: string | null;
        kind: string;
        expires_on: string | null;
        status: string;
      }[]
    >`
      select legal_name, kind::text as kind,
             expires_on::text as expires_on, status
        from staff.credential_status
       order by
         case status
           when 'expired' then 0 when 'critical' then 1
           when 'expiring' then 2 else 3 end,
         legal_name
    `,
    obligations: await sql<
      { title: string; due_on: string; status: string; owner_name: string | null }[]
    >`
      select title, due_on::text as due_on, status, owner_name
        from staff.obligation_register
       where status <> 'done'
       order by due_on
       limit 40
    `,
  }));

  const done = data.today.filter((t) => t.submitted_at).length;
  const flagged = data.today.filter((t) => t.has_out_of_range).length;
  const expired = data.creds.filter(
    (c) => c.status === "expired" || c.status === "critical"
  ).length;
  const overdue = data.obligations.filter((o) => o.status === "overdue").length;

  return (
    <div className="sv">
      <header className="sv-top">
        <span className="sv-brand">
          <BrandIcon size={26} />
          <Wordmark />
        </span>
        <span className="sv-badge">Inspector view · read only</span>
      </header>

      <main className="sv-main">
        <h1 className="sv-h1">{orgName}</h1>
        <p className="sv-sub">
          Issued for {ctx.label}. This link expires{" "}
          {formatSignedAt(ctx.expiresAt)} and is read-only.
        </p>

        <section className="sv-stats">
          <Stat label="Logged today" value={`${done} of ${data.today.length}`} />
          <Stat label="Out of range" value={String(flagged)} />
          <Stat label="Expired credentials" value={String(expired)} />
          <Stat label="Overdue obligations" value={String(overdue)} />
        </section>

        <Section title="Today's logs">
          {data.today.length === 0 ? (
            <p className="sv-empty">No logs are configured.</p>
          ) : (
            <table className="sv-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Slot</th>
                  <th>Filed</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {data.today.map((t, i) => (
                  <tr key={`${t.name}-${t.slot}-${i}`}>
                    <td>
                      {t.name}
                      {t.has_out_of_range && (
                        <span className="sv-flag">Out of range</span>
                      )}
                    </td>
                    <td>{t.slot ? t.slot.toUpperCase() : "—"}</td>
                    <td>
                      {t.submitted_at
                        ? formatSignedAt(t.submitted_at)
                        : "Not yet"}
                    </td>
                    <td>{t.submitted_by_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Credential currency">
          {/* Expiry dates and status. No licence, ARRT or DEA numbers
              exist anywhere in this system to show. */}
          {data.creds.length === 0 ? (
            <p className="sv-empty">No credentials recorded.</p>
          ) : (
            <table className="sv-table">
              <thead>
                <tr>
                  <th>Staff member</th>
                  <th>Credential</th>
                  <th>Expires</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.creds.map((c, i) => (
                  <tr key={i}>
                    <td>{c.legal_name ?? "—"}</td>
                    {/* The proper label, not the enum with its
                        underscores swapped for spaces. A state inspector
                        reading "bls cpr" on a compliance document learns
                        something about how carefully it was built. */}
                    <td>{KIND_LABELS[c.kind] ?? c.kind.replace(/_/g, " ")}</td>
                    <td>{c.expires_on ?? "No date"}</td>
                    <td>
                      <span className={`sv-state sv-state-${c.status}`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Open obligations">
          {data.obligations.length === 0 ? (
            <p className="sv-empty">Nothing outstanding.</p>
          ) : (
            <table className="sv-table">
              <thead>
                <tr>
                  <th>Obligation</th>
                  <th>Due</th>
                  <th>Owner</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.obligations.map((o, i) => (
                  <tr key={i}>
                    <td>{o.title}</td>
                    <td>{o.due_on}</td>
                    <td>{o.owner_name ?? "Unassigned"}</td>
                    <td>
                      <span className={`sv-state sv-state-${o.status}`}>
                        {o.status.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <p className="sv-foot">
          This view contains no patient information. It is a record of
          equipment checks, staff credential dates, and regulatory deadlines.
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sv-stat">
      <span className="sv-stat-value">{value}</span>
      <span className="sv-stat-label">{label}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="sv-section">
      <h2 className="sv-h2">{title}</h2>
      {children}
    </section>
  );
}

/** Expired, revoked, mistyped and never-existed all land here. */
function Expired() {
  return (
    <div className="sv sv-gone">
      <div className="sv-gone-card">
        <span className="sv-brand">
          <BrandIcon size={26} />
          <Wordmark />
        </span>
        <h1 className="sv-h1">This inspection link has expired</h1>
        <p className="sv-sub">
          Surveyor links are time-limited by design. Ask the centre
          administrator or medical director to issue a new one &mdash; it takes
          them one press, and the new link works immediately.
        </p>
      </div>
    </div>
  );
}

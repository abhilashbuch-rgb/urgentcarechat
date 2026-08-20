import BrandLockup from "@/app/components/BrandLockup";
import { signedUrl } from "@/lib/staff/storage";
import type { Metadata } from "next";
import { redeem, asSurveyor } from "@/lib/staff/surveyor";
import { getTenantBySlug } from "@/lib/tenants";
import { formatSignedAt } from "@/lib/staff/labels";
import { KIND_LABELS } from "@/lib/staff/credentials";

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

// Ten minutes: long enough to read the page and open every photograph,
// short enough that a URL copied out of the HTML is dead by the time it
// reaches anywhere else.
const PHOTO_URL_SECONDS = 600;

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
             has_out_of_range, submitted_by_name, response_id
        from staff.todays_logs
       order by sort_order, slot
    `,
    // PHOTOGRAPHS OF THE THING ITSELF.
    //
    // A log entry says the fridge read 4.1°C. A photograph of the NIST
    // display reading 4.1 is the difference between a record and
    // evidence — it is the single artefact a surveyor cannot argue with,
    // and it was being captured, stored, and then shown to nobody.
    //
    // Scoped to today's responses only, matching the rest of this page.
    // The bucket is private and stays private; each URL below is minted
    // per request and dies with the link.
    photos: await sql<
      {
        response_id: string;
        file_path: string;
        file_type: string;
        caption: string | null;
        taken_by_name: string | null;
        created_at: string;
      }[]
    >`
      select p.response_id, p.file_path, p.file_type, p.caption,
             u.legal_name as taken_by_name,
             p.created_at::text as created_at
        from staff.log_photos p
        join staff.form_responses r on r.id = p.response_id
        left join staff.users u on u.id = p.taken_by
       where r.submitted_at >= current_date
       order by p.created_at
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

  // SIGNED HERE, NOT IN THE MARKUP. The bucket is private; these URLs
  // are minted per request with a short life, so the page a surveyor
  // saves to disk stops resolving its images long before the link
  // itself expires. Failures are dropped rather than thrown: one
  // unreadable object must not take down the whole vault.
  const signed = await Promise.all(
    data.photos.map(async (p) => {
      try {
        return { ...p, url: await signedUrl(p.file_path, PHOTO_URL_SECONDS) };
      } catch {
        return { ...p, url: null };
      }
    })
  );
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
          <BrandLockup />
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

        {/* THE PHOTOGRAPHS.
            A row saying the fridge read 4.1°C is a record. A photograph
            of the display reading 4.1, taken at the clinic, at the time,
            by a named person, is evidence — and it is the one artefact
            in this vault that does not depend on trusting the person who
            typed the number.
            Given its own section rather than an icon in the table: a
            thumbnail in a cell is a decoration, a contact sheet is
            something a surveyor works through. */}
        {signed.length > 0 && (
          <Section title="Photographs filed today">
            <p className="sv-note">
              Taken in the app at the moment each log was filed. Captions
              are the staff member&rsquo;s own words. These images open for
              ten minutes and are not downloadable copies of anything
              stored publicly.
            </p>
            <div className="sv-proof-grid">
              {signed.map((p) => (
                <figure className="sv-proof" key={p.file_path}>
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.url}
                      alt={p.caption ?? "Photograph filed with a shift log"}
                      loading="lazy"
                    />
                  ) : (
                    <div className="sv-proof-gone">
                      Stored, but temporarily unreadable
                    </div>
                  )}
                  <figcaption>
                    <strong>{p.caption ?? "No caption"}</strong>
                    <span>
                      {p.taken_by_name ?? "Unknown"} &middot;{" "}
                      {formatSignedAt(p.created_at)}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </Section>
        )}

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
          <BrandLockup />
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

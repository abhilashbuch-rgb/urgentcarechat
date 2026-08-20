import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile, outstandingFor, signedBy } from "@/lib/staff/compliance";
import { ROLE_LABELS } from "@/lib/staff/roles";
import { formatSignedAt, formatDate } from "@/lib/staff/labels";
import { getTenantBySlug } from "@/lib/tenants";
import AvatarUpload from "@/app/components/staff/AvatarUpload";

// One employee's complete compliance record — the artifact the whole
// module exists to produce.
//
// It is theirs, not the employer's copy of it. Anyone can open their own
// at any time, print it, and see exactly what they signed and when. A
// record an employee cannot inspect is not evidence they were informed;
// it is just a claim by their employer.

export const dynamic = "force-dynamic";

export default async function MyRecord() {
  const { session, org } = await requireStaff();
  const tenant = await getTenantBySlug(org);

  const data = await withSession(session, async (sql) => ({
    profile: await getProfile(sql, session.uid),
    outstanding: await outstandingFor(sql, session.uid),
    signed: await signedBy(sql, session.uid),
    theme: (
      await sql<{ brand_color: string }[]>`
        select brand_color from staff.org_theme where slug = ${org}
      `
    )[0] ?? { brand_color: "#173a8a" },
  }));
  const theme = data.theme;

  const displayName =
    data.profile?.legal_name ?? data.profile?.name ?? session.email;
  const drifted = data.signed.filter((s) => s.text_matches === false);

  return (
    <div className="st-page">
      <header className="st-page-head st-record-head">
        <div>
          <h1 className="st-h1">Compliance record</h1>
          <p className="st-page-sub">
            {displayName}
            {data.profile?.job_title ? ` · ${data.profile.job_title}` : ""} ·{" "}
            {ROLE_LABELS[session.role]} · {tenant?.displayName ?? org}
          </p>
        </div>
        <button className="st-print" data-print>
          Print
        </button>
      </header>

      {/* The photo lives on the record rather than in a settings page.
          This is the screen a person already opens to check their own
          standing, and a profile picture nobody can find is a profile
          picture nobody sets. Excluded from print — a signed compliance
          record does not need a headshot on it. */}
      <section className="st-section st-no-print">
        <h2 className="st-h2">Your photo</h2>
        <AvatarUpload
          currentSrc={
            data.profile?.avatar_path
              ? `/api/staff/avatar/view?u=${session.uid}`
              : null
          }
          brandColor={theme.brand_color}
        />
      </section>

      <section className="st-cards">
        <article className="st-card">
          <p className="st-card-label">Documents signed</p>
          <p className="st-card-value">{data.signed.length}</p>
        </article>
        <article className={`st-card${data.outstanding.length ? " st-card-due" : ""}`}>
          <p className="st-card-label">Outstanding</p>
          <p className="st-card-value">{data.outstanding.length}</p>
          {data.outstanding.length > 0 && (
            <p className="st-card-note">
              <a href="/staff/onboarding">Complete them now &rarr;</a>
            </p>
          )}
        </article>
        <article className="st-card">
          <p className="st-card-label">Electronic signature consent</p>
          <p className="st-card-value st-card-value-sm">
            {data.profile?.esign_consented_at
              ? formatSignedAt(data.profile.esign_consented_at)
              : "Not given"}
          </p>
          {data.profile?.start_date && (
            <p className="st-card-note">
              Started {formatDate(data.profile.start_date)}
            </p>
          )}
        </article>
      </section>

      {drifted.length > 0 && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>
            {drifted.length === 1
              ? "One document has changed since you signed it"
              : `${drifted.length} documents have changed since you signed them`}
          </strong>
          <span>
            The current text no longer matches what you agreed to. Your
            signature still records the original wording, and you will be asked
            to review the new version. Flagged below.
          </span>
        </div>
      )}

      {data.outstanding.length > 0 && (
        <section className="st-record-section">
          <h2 className="st-h2">Still to sign</h2>
          <ul className="st-record-list">
            {data.outstanding.map((d) => (
              <li key={d.doc_id} className="st-record-row st-record-row-due">
                <div className="st-record-main">
                  <span className="st-record-title">{d.title}</span>
                  {d.citation && (
                    <span className="st-record-citation">{d.citation}</span>
                  )}
                </div>
                <span className="st-record-when">
                  {d.reason === "expired" ? "Annual renewal due" : "Not yet signed"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="st-record-section">
        <h2 className="st-h2">Signed</h2>
        {data.signed.length === 0 ? (
          <p className="st-empty">Nothing signed yet.</p>
        ) : (
          <ul className="st-record-list">
            {data.signed.map((s) => (
              <li key={s.id} className="st-record-row">
                <div className="st-record-main">
                  <span className="st-record-title">
                    {s.doc_title}
                    <span className="st-record-version">v{s.doc_version}</span>
                    {s.text_matches === false && (
                      <span className="st-tag st-tag-due">Text changed since</span>
                    )}
                  </span>
                  <span className="st-record-statement">
                    &ldquo;{s.statement}&rdquo;
                  </span>
                  <span className="st-record-hash">
                    Document fingerprint {s.body_sha256.slice(0, 16)}…
                  </span>
                </div>
                <div className="st-record-sig">
                  {s.signature_path && (
                    <svg
                      className="st-record-sig-mark"
                      viewBox="0 0 520 150"
                      role="img"
                      aria-label={`Signature of ${s.typed_name}`}
                    >
                      <path className="st-pad-ink" d={s.signature_path} />
                    </svg>
                  )}
                  <span className="st-record-signer">{s.typed_name}</span>
                  <span className="st-record-when">{formatSignedAt(s.signed_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="st-foot">
        Signatures on this page cannot be edited or removed &mdash; the database
        rejects any attempt, by anyone. Each one stores a fingerprint of the
        document text as it read when you signed, so the exact wording you
        agreed to can always be produced.
      </p>

      {/* One line of script rather than making the whole page a client
          component just to reach window.print(). */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.querySelector('[data-print]')?.addEventListener('click',function(){window.print()})",
        }}
      />
    </div>
  );
}

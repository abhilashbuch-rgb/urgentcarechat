import BrandLockup from "@/app/components/BrandLockup";
import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/site";

// Where the QR code on an exported binder points.
//
// WHAT THIS PAGE HONESTLY CAN AND CANNOT DO, stated on the page itself
// rather than implied by a green tick.
//
// It confirms that an export identifier was issued by this system and
// when. It does NOT attest that the paper in the surveyor's hand matches
// what was exported — that would need a content hash printed on every
// page and checked against a stored digest, which is a real feature and
// is not this one.
//
// A verification page that shows a green tick for an identifier it
// merely parsed would be worse than no page at all: it would lend
// authority to a document nobody checked. So this states exactly what it
// verified, and says plainly what it did not.

export const metadata: Metadata = {
  title: `Verify an export — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ cert?: string }>;
}) {
  const { cert } = await searchParams;
  const parsed = parseCert(cert);

  return (
    <div className="sv">
      <header className="sv-top">
        <span className="sv-brand">
          <BrandLockup />
        </span>
        <span className="sv-badge">Export verification</span>
      </header>

      <main className="sv-main">
        <h1 className="sv-h1">
          {parsed ? "This identifier is well-formed" : "That identifier is not readable"}
        </h1>

        {parsed ? (
          <>
            <p className="sv-sub">
              It was issued for <strong>{parsed.org}</strong> and generated{" "}
              {parsed.at.toISOString().replace("T", " ").slice(0, 19)} UTC.
            </p>

            <section className="sv-section">
              <h2 className="sv-h2">What this confirms</h2>
              <p className="sv-sub">
                That the identifier printed on the document has the shape this
                system issues, names a clinic, and carries the export time shown
                above.
              </p>
            </section>

            <section className="sv-section">
              <h2 className="sv-h2">What this does not confirm</h2>
              <p className="sv-sub">
                It does not prove the pages in your hand are the pages that were
                exported. Confirming that requires checking the document against
                the clinic&rsquo;s own records, which the centre administrator
                can produce on request &mdash; ask them to export a fresh copy
                and compare.
              </p>
            </section>
          </>
        ) : (
          <p className="sv-sub">
            Check the identifier printed under the QR code on the front page of
            the document, or ask the clinic to export a fresh copy.
          </p>
        )}

        <p className="sv-foot">
          This page reads an identifier only. It shows no clinic records and
          contains no patient information.
        </p>
      </main>
    </div>
  );
}

/** Identifiers are "<org-slug>-<epoch-ms>". Parsed rather than looked
 *  up: a lookup would need this public, unauthenticated page to query a
 *  clinic's data, which is a door this feature does not need to open. */
function parseCert(cert?: string): { org: string; at: Date } | null {
  if (!cert) return null;
  const m = /^([a-z0-9-]{1,64})-(\d{10,16})$/i.exec(cert.trim());
  if (!m) return null;
  const at = new Date(Number(m[2]));
  if (Number.isNaN(at.getTime())) return null;
  // A timestamp outside anything plausible is a malformed or invented
  // identifier rather than one this system produced.
  const year = at.getUTCFullYear();
  if (year < 2024 || year > 2100) return null;
  return { org: m[1], at };
}

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { resolvePending } from "@/lib/staff/auth";
import { withOrg } from "@/lib/staff/db";
import { getTenantBySlug } from "@/lib/tenants";
import { generateSecret, otpauthUri, formatSecret } from "@/lib/staff/totp";
import MfaForm from "@/app/components/staff/MfaForm";
import { PRODUCT_NAME } from "@/lib/site";

// Enrolment. The secret is minted server-side on this render and stored
// unconfirmed; it only becomes the user's second factor once they have
// proved they can produce a code from it. An unconfirmed secret grants
// nothing, so a half-finished enrolment leaves no half-open door.

export const dynamic = "force-dynamic";

export default async function MfaEnroll() {
  const pending = await resolvePending();
  if (!pending.ok) redirect(`/staff/signin?e=${pending.reason}`);
  if (pending.ctx.session.mfa === "ok") redirect("/staff");
  // Already has a confirmed factor — this page would let them replace it
  // without presenting the old one, which is the wrong door entirely.
  if (pending.mfaEnrolled) redirect("/staff/mfa");

  const { session, org } = pending.ctx;
  const tenant = await getTenantBySlug(org);
  const issuer = tenant?.displayName ?? PRODUCT_NAME;

  const secret = await withOrg(org, session.role, async (sql) => {
    const existing = await sql<{ totp_secret: string | null }[]>`
      select totp_secret from staff.users where id = ${session.uid}
    `;
    // Reuse an unconfirmed secret across refreshes. Minting a new one on
    // every render would invalidate the QR the person is mid-way through
    // scanning.
    if (existing[0]?.totp_secret) return existing[0].totp_secret;

    const fresh = generateSecret();
    await sql`update staff.users set totp_secret = ${fresh} where id = ${session.uid}`;
    return fresh;
  });

  const qrDataUri = await QRCode.toDataURL(
    otpauthUri(secret, session.email, issuer),
    { margin: 1, width: 400, errorCorrectionLevel: "M" }
  );

  return (
    <div className="st-signin">
      <div className="st-signin-card st-signin-card-wide">
        <p className="st-signin-eyebrow">{issuer}</p>
        <h1 className="st-signin-title">Set up two-step verification</h1>
        {/* THE BUG THIS REPLACES: this line used to say "a password and
            a Google account aren't enough on their own" — there is no
            password anywhere in this product. Sign-in is Google or an
            emailed code; someone arriving from the emailed-code path
            had never seen a password screen and had nothing to
            reconcile that sentence against. Said plainly instead. */}
        <p className="st-signin-sub">
          Your role has access to other people&rsquo;s records, so signing in
          alone isn&rsquo;t enough &mdash; you also need an authenticator app
          on your phone (Google Authenticator, Authy, or similar). Scan a
          code, enter what it shows you, and you are done. One minute,
          once.
        </p>
        <MfaForm
          mode="enroll"
          qrDataUri={qrDataUri}
          secretDisplay={formatSecret(secret)}
        />
      </div>
    </div>
  );
}

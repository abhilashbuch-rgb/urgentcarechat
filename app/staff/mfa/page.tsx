import { redirect } from "next/navigation";
import { resolvePending } from "@/lib/staff/auth";
import { getTenantBySlug } from "@/lib/tenants";
import MfaForm from "@/app/components/staff/MfaForm";

// The challenge screen. Reached only by a session that has proved who it
// is and not yet proved it is them.

export const dynamic = "force-dynamic";

export default async function MfaChallenge() {
  const pending = await resolvePending();
  if (!pending.ok) redirect(`/staff/signin?e=${pending.reason}`);

  // Already satisfied, or never needed one — either way this page has
  // nothing to ask.
  if (pending.ctx.session.mfa === "ok") redirect("/staff");
  if (!pending.mfaEnrolled) redirect("/staff/mfa/enroll");

  const tenant = await getTenantBySlug(pending.ctx.org);

  return (
    <div className="st-signin">
      <div className="st-signin-card">
        <p className="st-signin-eyebrow">{tenant?.displayName ?? pending.ctx.org}</p>
        <h1 className="st-signin-title">Two-step verification</h1>
        <p className="st-signin-sub">
          Open your authenticator app and enter the code for{" "}
          {pending.ctx.session.email}.
        </p>
        <MfaForm mode="challenge" />
        <p className="st-signin-fine">
          Lost the device? An administrator can reset your second factor. Nobody
          can read it out to you &mdash; not even them.
        </p>
      </div>
    </div>
  );
}

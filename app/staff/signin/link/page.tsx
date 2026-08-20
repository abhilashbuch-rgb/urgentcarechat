import BrandLockup from "@/app/components/BrandLockup";
import { redirect } from "next/navigation";
import LinkRedeemer from "@/app/components/staff/LinkRedeemer";

// Where the link in the sign-in email lands.
//
// THE REDEMPTION IS A POST FROM THE CLIENT, NOT A GET ON THIS PAGE, and
// that is the whole reason this page exists rather than the route
// handling the link directly.
//
// A GET that signs somebody in is a GET that mail scanners, link
// previewers and corporate security appliances will fire on the
// recipient's behalf — burning the single-use token before the human
// ever clicks. Microsoft Defender for Office 365 does exactly this.
// Rendering a page that then POSTs means the token survives the scanner
// and is spent by a real browser.

export const dynamic = "force-dynamic";

export default async function LinkLanding({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  if (!t) redirect("/staff/signin");

  return (
    <div className="st-signin">
      <div className="st-signin-card">
        <div className="st-signin-brand">
          <BrandLockup />
        </div>
        <h1 className="st-signin-title">Signing you in</h1>
        <LinkRedeemer token={t} />
      </div>
    </div>
  );
}

import BrandLockup from "@/app/components/BrandLockup";
import { redirect } from "next/navigation";
import InviteRedeemer from "@/app/components/staff/InviteRedeemer";

// Where the link in an invitation email lands.
//
// The invitation is accepted by a POST from the browser, not by this
// page rendering — see InviteRedeemer for why.

export const dynamic = "force-dynamic";

export default async function InviteLanding({
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
          <BrandLockup tagline />
        </div>
        <h1 className="st-signin-title">You&rsquo;ve been invited</h1>
        <InviteRedeemer token={t} />
      </div>
    </div>
  );
}

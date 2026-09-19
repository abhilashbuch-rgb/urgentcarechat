import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { isSmsConfigured } from "@/lib/twilio";
import PhoneForm from "@/app/components/staff/PhoneForm";

// Self-serve phone verification. One page, reachable by every signed-in
// staff account — this is not an admin tool, because the whole point is
// that a person proves their own number, not that somebody else types
// it in for them.

export const dynamic = "force-dynamic";

export default async function StaffPhone() {
  const { session } = await requireStaff();

  const row = await withSession(session, async (sql) => {
    const [r] = await sql<{ phone: string | null; phone_verified_at: string | null }[]>`
      select phone, phone_verified_at::text as phone_verified_at
        from staff.users where id = ${session.uid}
    `;
    return r ?? null;
  });

  // A profile-less admin (see the Overview.hasProfile comment on
  // app/staff/page.tsx) has no staff.users row reachable this way — no
  // number to verify, nowhere useful to send them.
  if (!row) redirect("/staff");

  if (row.phone_verified_at) {
    return (
      <div className="st-signin">
        <div className="st-signin-card">
          <p className="st-signin-eyebrow">Phone number</p>
          <h1 className="st-signin-title">You&rsquo;re verified</h1>
          <p className="st-signin-sub">
            {row.phone} is confirmed. You&rsquo;ll get a text for anything
            urgent this product catches that goes to your number.
          </p>
          <Link className="st-btn" href="/staff">
            Back to Today
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="st-signin">
      <div className="st-signin-card st-signin-card-wide">
        <p className="st-signin-eyebrow">Phone number</p>
        <h1 className="st-signin-title">Add and verify your phone number</h1>
        <p className="st-signin-sub">
          So you can actually be texted, not just emailed &mdash; we&rsquo;ll
          text a code first to prove the number&rsquo;s really yours.
        </p>
        {isSmsConfigured() ? (
          <PhoneForm currentPhone={row.phone} />
        ) : (
          <p className="st-sign-error" role="alert">
            Texting isn&rsquo;t turned on for this clinic yet &mdash; ask an
            admin.
          </p>
        )}
      </div>
    </div>
  );
}

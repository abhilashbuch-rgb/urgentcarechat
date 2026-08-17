import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import NewObligation from "@/app/components/staff/NewObligation";

// Adding an obligation.
//
// The seeded register covers what every urgent care owes. This exists for
// the rest: a deadline that arrived in an email — an accreditation
// finding with a correction date, a franchise bulletin, a state rule that
// only applies to this site. Those are precisely the ones that get lost,
// because they arrive once and are addressed to nobody.

export const dynamic = "force-dynamic";

export default async function NewObligationPage() {
  const { session } = await requireStaff();
  if (!atLeast(session.role, "org_admin")) redirect("/staff/obligations");

  const team = await withSession(
    session,
    (sql) => sql<{ id: string; label: string }[]>`
      select id, coalesce(legal_name, name, email) as label
        from staff.users where active order by label
    `
  );

  return (
    <div className="st-page">
      <p className="st-back">
        <Link href="/staff/obligations">&larr; Obligations</Link>
      </p>
      <header className="st-page-head">
        <h1 className="st-h1">Add an obligation</h1>
        <p className="st-page-sub">
          Something this clinic owes by a date, with a name against it.
        </p>
      </header>
      <NewObligation team={team} />
    </div>
  );
}

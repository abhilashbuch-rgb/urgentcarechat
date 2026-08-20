import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { atLeast } from "@/lib/staff/roles";
import ProtocolSearch from "@/app/components/staff/ProtocolSearch";

// Protocol search.
//
// CALLED "PROTOCOLS" AND NOT "CLINICAL AI", deliberately. What this does
// is rank passages of the clinic's own protocol library against the
// words you typed and show them to you verbatim with their source. That
// is a good search box and it is not artificial intelligence, and a nav
// label promising the second while delivering the first is the same
// broken promise as a homepage advertising an unshipped feature — made
// to a clinician, who will notice within one query.
//
// It also does not generate advice, and the name is part of how that
// stays true: nobody asks "why doesn't Protocols tell me the dose".

export const dynamic = "force-dynamic";

export default async function ProtocolsPage() {
  const { session } = await requireStaff();

  const profile = await withSession(session, (sql) =>
    getProfile(sql, session.uid)
  );
  const jobRole = profile?.job_role ?? null;
  const clinical = jobRole === "provider" || jobRole === "center_admin";
  const allowed = clinical || atLeast(session.role, "clinical_lead");

  if (!allowed) {
    return (
      <div className="st-page st-page-narrow">
        <header className="st-page-head">
          <h1 className="st-h1">Protocols</h1>
        </header>
        <div className="st-notice st-notice-warn" role="status">
          <strong>This one is for clinical staff</strong>
          <span>
            Clinical protocols are open to providers and clinical leads. If a
            patient is asking you something clinical, the answer is on Rules
            &mdash; including the sentence to say while you go and get
            somebody.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <h1 className="st-h1">Protocols</h1>
        <p className="st-page-sub">
          Your clinic&rsquo;s protocols and the guidance loaded alongside them,
          searchable. Results are the text as written, with its source.
        </p>
      </header>

      <ProtocolSearch />

      {/* Said once, on the page, rather than in a modal nobody reads.
          This is a search box over documents; it does not decide
          anything and it does not know about the patient. */}
      <p className="st-sign-fine">
        This searches documents. It does not give advice, work out a dose, or
        know anything about the patient in front of you &mdash; it finds the
        passage and shows you who wrote it and when.
      </p>
    </div>
  );
}

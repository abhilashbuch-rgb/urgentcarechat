import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { myDocuments } from "@/lib/staff/documents";
import { isStorageConfigured } from "@/lib/staff/storage";
import DocumentShelf from "@/app/components/staff/DocumentShelf";

// My credentials and documents.
//
// THE OTHER END OF THE ROSTER. The roster answers the organisation's
// question — is anybody working expired — and until now the only way a
// BLS card got on file was somebody senior typing it in for twenty
// people. This is the same fact maintained by the person it belongs to,
// which is the only version of it that stays current.
//
// EVERYONE GETS THIS PAGE, including the people who cannot see the
// roster. That is the point of it: your own documents are yours to see
// whatever your role is, and nobody else's appear here at any role.

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { session } = await requireStaff();

  const documents = await withSession(session, (sql) =>
    myDocuments(sql, session.uid)
  );

  const expired = documents.filter((d) => d.status === "expired").length;
  const expiring = documents.filter((d) => d.status === "expiring").length;

  return (
    <div className="st-page st-page-narrow">
      <header className="st-page-head">
        <h1 className="st-h1">My documents</h1>
        <p className="st-page-sub">
          {documents.length === 0
            ? "Your certifications and licences, kept by you."
            : expired > 0
              ? `${expired} expired${expiring > 0 ? `, ${expiring} expiring soon` : ""}.`
              : expiring > 0
                ? `${expiring} expiring in the next 60 days.`
                : "Everything current."}
        </p>
      </header>

      <DocumentShelf
        documents={documents}
        uploadsEnabled={isStorageConfigured()}
      />

      <p className="st-sign-fine">
        Only you and your clinic&rsquo;s administrators can see these. Dates go
        straight onto the roster, so entering one here is what stops somebody
        chasing you for it. This app never stores a licence, ARRT or DEA
        number.
      </p>
    </div>
  );
}

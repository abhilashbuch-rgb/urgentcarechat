import type { StaffSql } from "@/lib/staff/db";

// A person's own credential shelf.
//
// EVERY FUNCTION HERE TAKES A USER ID AND FILTERS ON IT. RLS scopes
// these tables to the ORG, not to the person — there is one database
// role for the whole application and the session's user id is not
// visible to a policy (see staff.current_org() in staff-schema.sql). So
// per-user isolation lives here, and the argument is required rather
// than optional so that omitting it is a type error and not a silent
// leak of one colleague's licence to another.

export const DOC_TYPES = [
  "bls_cpr",
  "state_license",
  "arrt_permit",
  "board_certification",
  "malpractice",
  "cme_log",
  "peer_review",
  "tb_screening",
  "hepatitis_b_vaccination",
  "other",
] as const;

export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  bls_cpr: "BLS / CPR card",
  state_license: "State licence",
  arrt_permit: "ARRT or operator permit",
  board_certification: "Board certification",
  malpractice: "Malpractice cover",
  cme_log: "CME record",
  peer_review: "Peer review",
  tb_screening: "TB screening",
  hepatitis_b_vaccination: "Hepatitis B vaccination",
  other: "Other",
};

/** Which document types stand for a credential the roster tracks. A
 *  document of one of these kinds updates the matching credential rather
 *  than storing a second copy of the same expiry date. */
export const DOC_TYPE_TO_CREDENTIAL: Partial<Record<DocType, string>> = {
  bls_cpr: "bls_cpr",
  state_license: "state_license",
  arrt_permit: "arrt",
  board_certification: "board_certification",
  malpractice: "malpractice",
  tb_screening: "tb_screening",
  hepatitis_b_vaccination: "hepatitis_b_vaccination",
};

export interface MyDocument {
  id: string;
  doc_type: DocType;
  title: string;
  file_path: string | null;
  file_type: string | null;
  file_bytes: number | null;
  expires_on: string | null;
  verified_on: string | null;
  verified_by_name: string | null;
  uploaded_at: string;
  has_file: boolean;
  status: "no_date" | "expired" | "expiring" | "current";
  days_left: number | null;
}

export async function myDocuments(
  sql: StaffSql,
  userId: string
): Promise<MyDocument[]> {
  return sql<MyDocument[]>`
    select id, doc_type, title, file_path, file_type, file_bytes,
           expires_on::text as expires_on,
           verified_on::text as verified_on, verified_by_name,
           uploaded_at::text as uploaded_at,
           has_file, status, days_left
      from staff.my_documents
     where user_id = ${userId}
     order by
       case status
         when 'expired'  then 0
         when 'expiring' then 1
         when 'no_date'  then 2
         else 3
       end,
       expires_on nulls last,
       uploaded_at desc
  `;
}

/** Record a document, and keep the roster in step.
 *
 *  ONE FACT, NOT TWO. When the document stands for a tracked credential
 *  and carries an expiry, the matching staff.credentials row is created
 *  or moved to that date. Storing the date in both places independently
 *  would give the roster and the person's own shelf two answers to one
 *  question, and the roster would be reading whichever one nobody
 *  maintained. */
export async function addDocument(
  sql: StaffSql,
  args: {
    org: string;
    userId: string;
    docType: DocType;
    title: string;
    expiresOn: string | null;
    filePath: string | null;
    fileType: string | null;
    fileBytes: number | null;
  }
): Promise<string> {
  let credentialId: string | null = null;
  const credKind = DOC_TYPE_TO_CREDENTIAL[args.docType];

  if (credKind && args.expiresOn) {
    const existing = await sql<{ id: string }[]>`
      select id from staff.credentials
       where user_id = ${args.userId}
         and kind = ${credKind}::staff.credential_kind
         and active
       limit 1
    `;
    if (existing.length > 0) {
      credentialId = existing[0].id;
      await sql`
        update staff.credentials
           set expires_on = ${args.expiresOn}::date
         where id = ${credentialId}
      `;
    } else {
      const [created] = await sql<{ id: string }[]>`
        insert into staff.credentials (org_slug, user_id, kind, expires_on)
        values (${args.org}, ${args.userId},
                ${credKind}::staff.credential_kind, ${args.expiresOn}::date)
        returning id
      `;
      credentialId = created.id;
    }
  }

  const [row] = await sql<{ id: string }[]>`
    insert into staff.user_documents
      (org_slug, user_id, doc_type, title, credential_id,
       file_path, file_type, file_bytes, expires_on)
    values
      (${args.org}, ${args.userId}, ${args.docType}, ${args.title},
       ${credentialId}, ${args.filePath}, ${args.fileType},
       ${args.fileBytes}, ${args.expiresOn}::date)
    returning id
  `;
  return row.id;
}

/** Retire one of your own documents. Deactivated, never deleted — and
 *  the user id is in the WHERE clause, so a guessed id belonging to a
 *  colleague matches nothing. */
export async function retireDocument(
  sql: StaffSql,
  userId: string,
  id: string
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update staff.user_documents
       set active = false
     where id = ${id} and user_id = ${userId} and active
    returning id
  `;
  return rows.length > 0;
}

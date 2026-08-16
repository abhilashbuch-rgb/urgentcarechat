import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";

// POST /api/staff/attest — record one signature.
//
// The client sends only the document id, the typed name, and the drawn
// path. Everything that constitutes evidence — which text was signed, its
// hash, the attestation wording, the timestamp — is read server-side from
// the document row. A client that could supply its own hash or its own
// statement could produce a signature for text nobody ever saw, which
// would make the whole record worthless.

export const runtime = "nodejs";

const MAX_PATH_CHARS = 20000; // a long signature is ~2-4k; this is generous
const MAX_NAME_CHARS = 120;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text) as BufferSource
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  let body: { docId?: string; typedName?: string; signaturePath?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const docId = typeof body.docId === "string" ? body.docId : "";
  const typedName = (body.typedName ?? "").trim().slice(0, MAX_NAME_CHARS);
  const signaturePath = (body.signaturePath ?? "").slice(0, MAX_PATH_CHARS);

  if (!docId || typedName.length < 2) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  // The path is rebuilt from numbers before it reaches the DOM, but it is
  // also stored and re-rendered, so anything that isn't SVG path syntax is
  // rejected rather than sanitized.
  if (signaturePath && !/^[ML\d\s.,-]*$/.test(signaturePath)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  // Forwarded-for is a chain; the client-supplied end is the first entry
  // and the only one worth keeping. It is evidence about circumstances,
  // not an access control input, so a spoofed value costs nothing.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 400) ?? null;

  try {
    const result = await withSession(session, async (sql) => {
      const docs = await sql<
        { id: string; key: string; version: number; title: string; body_md: string; attestation: string }[]
      >`
        select id, key, version, title, body_md, attestation
          from staff.policy_docs
         where id = ${docId} and active and published_at is not null
      `;
      // Unpublished or another org's document: RLS already made the second
      // case impossible, and the first is why publishing is a gate at all.
      if (docs.length === 0) return { error: "no_such_doc" as const };

      const doc = docs[0];
      const hash = await sha256Hex(doc.body_md);

      const inserted = await sql<{ id: string }[]>`
        insert into staff.attestations
          (org_slug, user_id, doc_id, doc_key, doc_version, doc_title,
           body_sha256, statement, typed_name, signature_path,
           signed_ip, user_agent)
        values
          (${org}, ${session.uid}, ${doc.id}, ${doc.key}, ${doc.version},
           ${doc.title}, ${hash}, ${doc.attestation}, ${typedName},
           ${signaturePath || null}, ${ip}, ${userAgent})
        on conflict (user_id, doc_id) do nothing
        returning id
      `;

      // Already signed. Not an error the person needs to fix — a double
      // submit, or a second tab — but not something to silently overwrite
      // either, since the row is immutable by design.
      if (inserted.length === 0) return { error: "already_signed" as const };

      await sql`
        insert into staff.audit_log (org_slug, actor_id, action, entity, entity_id, detail)
        values (${org}, ${session.uid}, 'attested', 'policy_doc', ${doc.id},
                ${sql.json({ key: doc.key, version: doc.version })})
      `;

      return { id: inserted[0].id };
    });

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "already_signed" ? 409 : 404 }
      );
    }
    return NextResponse.json({ ok: true, id: result.id });
  } catch (err) {
    console.error(
      "[staff-attest] failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

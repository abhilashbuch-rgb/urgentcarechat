import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import {
  addDocument,
  retireDocument,
  DOC_TYPES,
  type DocType,
} from "@/lib/staff/documents";
import {
  isStorageConfigured,
  keyFor,
  putFile,
} from "@/lib/staff/storage";

// POST   /api/staff/documents — record one of YOUR OWN documents
// DELETE /api/staff/documents?id=… — retire one of YOUR OWN documents
//
// EVERY WRITE IS SCOPED TO session.uid AND NOTHING ELSE. There is no
// parameter here for whose document this is, because there is no
// legitimate reason for one person to file a document against another
// person's name, and the safest way to guarantee that is to give the
// route no way to express it.
//
// Uploads are optional. See lib/staff/storage.ts: a deployment without a
// storage bucket still records the expiry date, which is the part the
// roster needs, and says so plainly rather than 500ing at somebody who
// has just tried to attach their BLS card.

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
]);

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "bad_form" }, { status: 400 });
  }

  const docType = String(form.get("doc_type") ?? "");
  if (!DOC_TYPES.includes(docType as DocType)) {
    return NextResponse.json({ error: "bad_doc_type" }, { status: 400 });
  }

  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  if (title.length < 2) {
    return NextResponse.json({ error: "missing_title" }, { status: 400 });
  }

  const rawExpiry = String(form.get("expires_on") ?? "").trim();
  let expiresOn: string | null = null;
  if (rawExpiry) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawExpiry)) {
      return NextResponse.json({ error: "bad_date" }, { status: 400 });
    }
    // 2026-02-31 parses to a different day in Postgres rather than
    // failing, so the round trip is checked here.
    const d = new Date(`${rawExpiry}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== rawExpiry) {
      return NextResponse.json({ error: "bad_date" }, { status: 400 });
    }
    expiresOn = rawExpiry;
  }

  const file = form.get("file");
  const hasFile = file instanceof File && file.size > 0;

  // The table's own CHECK says the same thing. Answered here too so the
  // person gets a sentence rather than a constraint name.
  if (!hasFile && !expiresOn) {
    return NextResponse.json({ error: "nothing_to_record" }, { status: 400 });
  }

  let filePath: string | null = null;
  let fileType: string | null = null;
  let fileBytes: number | null = null;

  if (hasFile) {
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: "uploads_not_enabled" },
        { status: 503 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "bad_file_type" }, { status: 415 });
    }

    const key = keyFor(org, session.uid, file.name);
    try {
      await putFile(key, await file.arrayBuffer(), file.type);
    } catch (err) {
      console.error(
        "[staff-documents] upload failed:",
        err instanceof Error ? err.message : "Unknown"
      );
      return NextResponse.json({ error: "upload_failed" }, { status: 502 });
    }
    filePath = key;
    fileType = file.type;
    fileBytes = file.size;
  }

  const id = await withSession(session, (sql) =>
    addDocument(sql, {
      org,
      userId: session.uid,
      docType: docType as DocType,
      title,
      expiresOn,
      filePath,
      fileType,
      fileBytes,
    })
  );

  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session } = auth.ctx;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  // retireDocument filters on the user id as well as the row id, so a
  // guessed id belonging to a colleague matches nothing and returns 404
  // — the same answer as an id that does not exist, which is the answer
  // that leaks least.
  const done = await withSession(session, (sql) =>
    retireDocument(sql, session.uid, id)
  );
  if (!done) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}

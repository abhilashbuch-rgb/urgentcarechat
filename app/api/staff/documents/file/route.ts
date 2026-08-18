import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { isStorageConfigured, signedUrl } from "@/lib/staff/storage";

// GET /api/staff/documents/file?id=… — a short-lived link to one of YOUR
// OWN uploaded files.
//
// THE FILE PATH IS NEVER TAKEN FROM THE REQUEST. The caller sends a
// document id; the path is looked up from the row, and the lookup is
// filtered by the session's user id. A route that signed whatever key it
// was handed would sign any key in the bucket, which is every clinic's
// licences at once.

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session } = auth.ctx;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "uploads_not_enabled" }, { status: 503 });
  }

  const rows = await withSession(session, (sql) =>
    sql<{ file_path: string | null }[]>`
      select file_path from staff.user_documents
       where id = ${id} and user_id = ${session.uid} and active
    `
  );
  const path = rows[0]?.file_path;
  if (!path) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const url = await signedUrl(path);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    console.error(
      "[staff-documents] signing failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "sign_failed" }, { status: 502 });
  }
}

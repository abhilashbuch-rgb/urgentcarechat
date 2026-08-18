import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { isStorageConfigured, signedUrl } from "@/lib/staff/storage";

// GET /api/staff/avatar/view?u=<user id> — a short-lived link to one
// colleague's photo.
//
// UNLIKE THE DOCUMENT VAULT, THIS IS READABLE ACROSS THE ORG, and that
// is the point: an avatar exists so colleagues recognise each other on a
// roster and against a signature. RLS still scopes the lookup to the
// caller's own clinic, so this cannot reach another org's staff.
//
// The object key never comes from the request — only a user id, which is
// looked up. A route that signed whatever key it was given would sign
// every key in the bucket, and the same bucket holds licences.

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session } = auth.ctx;

  const uid = req.nextUrl.searchParams.get("u") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(uid)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "uploads_not_enabled" }, { status: 503 });
  }

  const rows = await withSession(session, (sql) =>
    sql<{ avatar_path: string | null }[]>`
      select avatar_path from staff.users where id = ${uid} and active
    `
  );
  const path = rows[0]?.avatar_path;
  if (!path) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    return NextResponse.redirect(await signedUrl(path, 900), 302);
  } catch {
    return NextResponse.json({ error: "sign_failed" }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { isStorageConfigured, keyFor, putFile } from "@/lib/staff/storage";

// POST   /api/staff/avatar — replace YOUR OWN photo
// DELETE /api/staff/avatar — remove YOUR OWN photo
//
// There is no user parameter on either verb, deliberately: nobody has a
// reason to set somebody else's profile picture, and the safest way to
// guarantee that is to leave the route no way to say it.
//
// The browser has already cropped to a 512x512 square and re-encoded it
// through canvas, which strips EXIF — including the GPS tag a phone
// camera writes. See app/components/staff/AvatarUpload.tsx. The size cap
// here is what a 512px WebP should be plus generous headroom, so a
// hand-made request cannot post a 40MB file at the bucket.

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/webp", "image/jpeg", "image/png"]);

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "uploads_not_enabled" }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "bad_file_type" }, { status: 415 });
  }

  const key = keyFor(org, session.uid, "avatar.webp");
  try {
    await putFile(key, await file.arrayBuffer(), file.type);
  } catch (err) {
    console.error(
      "[staff-avatar] upload failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  // The previous object is intentionally left in the bucket rather than
  // deleted here. A delete that races the update would leave a row
  // pointing at nothing, which renders as a broken image on every screen
  // that person appears on; an orphaned object costs a few kilobytes and
  // is swept separately. Wrong direction to fail in.
  await withSession(session, (sql) =>
    sql`
      update staff.users
         set avatar_path = ${key}, avatar_updated_at = now()
       where id = ${session.uid}
    `
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session } = auth.ctx;

  await withSession(session, (sql) =>
    sql`
      update staff.users
         set avatar_path = null, avatar_updated_at = now()
       where id = ${session.uid}
    `
  );

  return NextResponse.json({ ok: true });
}

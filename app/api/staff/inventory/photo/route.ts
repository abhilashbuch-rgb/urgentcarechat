import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { billingState } from "@/lib/staff/billing";
import { isStorageConfigured, keyFor, putFile } from "@/lib/staff/storage";

// POST /api/staff/inventory/photo — attach a photograph to a count
// already filed. Same shape as app/api/staff/logs/photo/route.ts and
// for the same reason: if the photo travelled with the count, a failed
// upload would fail the count itself, and a missing count is far worse
// than a missing photograph.

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;
// Same restriction as logs/photo, same reason: pdf-lib only embeds JPEG
// and PNG, and this photo may eventually need to travel into a rendered
// report the same way a log's does.
const ALLOWED = new Set(["image/jpeg", "image/png"]);
const MAX_CAPTION = 200;

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });

  const countId = String(form.get("count_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(countId)) {
    return NextResponse.json({ error: "bad_count_id" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "bad_file_type" }, { status: 415 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "uploads_not_enabled" }, { status: 503 });
  }

  const caption = String(form.get("caption") ?? "").trim().slice(0, MAX_CAPTION);

  return withSession(session, async (sql) => {
    const billing = await billingState(sql, org);
    if (billing.is_read_only) {
      return NextResponse.json({ error: "read_only" }, { status: 402 });
    }

    // The count must exist AND be visible under this org's RLS — an id
    // from another clinic simply does not resolve.
    const [row] = await sql<{ id: string }[]>`
      select id from staff.inventory_counts where id = ${countId}
    `;
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const key = keyFor(org, countId, "proof.jpg");
    try {
      await putFile(key, await file.arrayBuffer(), file.type, "media");
    } catch (err) {
      console.error(
        "[inventory-photo] upload failed:",
        err instanceof Error ? err.message : "Unknown"
      );
      return NextResponse.json({ error: "upload_failed" }, { status: 502 });
    }

    const [saved] = await sql<{ id: string }[]>`
      insert into staff.inventory_photos
        (org_slug, count_id, file_path, file_type, file_bytes, caption, taken_by)
      values
        (${org}, ${countId}, ${key}, ${file.type}, ${file.size},
         ${caption || null}, ${session.uid})
      returning id
    `;

    return NextResponse.json({ ok: true, id: saved.id });
  });
}

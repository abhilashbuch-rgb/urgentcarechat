import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { billingState } from "@/lib/staff/billing";
import { isStorageConfigured, keyFor, putFile } from "@/lib/staff/storage";

// POST /api/staff/logs/photo — attach a photograph to a log already filed.
//
// SEPARATE FROM THE SUBMIT ROUTE, DELIBERATELY. If the photo travelled
// with the submission, a failed upload would fail the whole log — and a
// missing log is far worse than a missing photograph. This way the
// reading is recorded the instant it is typed, and the picture follows.
// On clinic wifi in a back corridor that ordering is the difference
// between a record and nothing.
//
// The browser has already re-encoded to 1600x1200 JPEG, which strips
// EXIF including the GPS tag. See app/components/staff/CameraProof.tsx.

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;
// JPEG AND PNG ONLY, AND WEBP IS EXCLUDED ON PURPOSE.
//
// pdf-lib exposes embedJpg and embedPng and nothing else. A webp upload
// stored cleanly, displayed cleanly in the surveyor vault, and then
// disappeared from the exported binder without an error anywhere —
// meaning the one photograph somebody bothered to take would be missing
// from the document handed to an inspector.
//
// Nothing is lost by refusing it: a camera capture arrives as JPEG, and
// canvas.toBlob falls back to PNG. Webp only appears when somebody picks
// an existing file from a gallery.
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

  const responseId = String(form.get("response_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(responseId)) {
    return NextResponse.json({ error: "bad_response_id" }, { status: 400 });
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
    // Same read-only rule as the log itself: a lapsed card pauses new
    // evidence, and never hides what is already recorded.
    const billing = await billingState(sql, org);
    if (billing.is_read_only) {
      return NextResponse.json({ error: "read_only" }, { status: 402 });
    }

    // The response must exist AND be visible under this org's RLS. An id
    // from another clinic simply does not resolve, so a guessed one
    // cannot bolt a photograph onto somebody else's record.
    const [row] = await sql<{ id: string }[]>`
      select id from staff.form_responses where id = ${responseId}
    `;
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const key = keyFor(org, responseId, "proof.jpg");
    try {
      await putFile(key, await file.arrayBuffer(), file.type, "media");
    } catch (err) {
      console.error(
        "[log-photo] upload failed:",
        err instanceof Error ? err.message : "Unknown"
      );
      return NextResponse.json({ error: "upload_failed" }, { status: 502 });
    }

    const [saved] = await sql<{ id: string }[]>`
      insert into staff.log_photos
        (org_slug, response_id, file_path, file_type, file_bytes, caption, taken_by)
      values
        (${org}, ${responseId}, ${key}, ${file.type}, ${file.size},
         ${caption || null}, ${session.uid})
      returning id
    `;

    return NextResponse.json({ ok: true, id: saved.id });
  });
}

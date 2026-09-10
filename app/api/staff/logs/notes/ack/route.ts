import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { acknowledgeNote } from "@/lib/staff/logs";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/logs/notes/ack — "Got it," from whoever the note was
// actually addressed to. No role gate: this is self-scoped the same
// way board-prefs is — every account may acknowledge their own note,
// nobody else's. acknowledgeNote() enforces that at the query, not
// here, same split as everywhere else in this module.
//
// A plain form POST from /staff/logs, so it works with zero JS. The
// point of read_at is that it is set by this tap and by nothing else —
// see staff-log-notes.sql.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session } = auth.ctx;

  const form = await req.formData();
  const noteId = String(form.get("noteId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(noteId)) {
    return redirectAfterPost("/staff/logs?e=bad_request");
  }

  try {
    await withSession(session, (sql) => acknowledgeNote(sql, session.uid, noteId));
  } catch (err) {
    console.error(
      "[staff-log-notes] ack failed for note",
      noteId,
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/logs?e=save");
  }

  return redirectAfterPost("/staff/logs");
}

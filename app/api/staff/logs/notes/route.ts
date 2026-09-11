import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { noteOnLog } from "@/lib/staff/logs";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/logs/notes — a manager (or above) attaching one
// acknowledgment note to one already-filed log.
//
// A plain form POST from /staff/activity, same reason as board-prefs
// and settings/logs: it works from a phone and the navigation is the
// feedback. Gated at atLeast(role, "manager") — the same line
// /staff/activity itself is gated at, since this is a note ON that
// page's own rows and nobody who cannot see the board should be able
// to write to it.
//
// See staff-log-notes.sql for why this is one note per log, not a
// thread, and why it is not the staff messenger lib/staff/roles.ts
// explicitly turned down.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  if (!atLeast(session.role, "manager")) {
    return redirectAfterPost("/staff/activity?e=forbidden");
  }

  const form = await req.formData();
  const responseId = String(form.get("responseId") ?? "");
  const body = String(form.get("body") ?? "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(responseId) || body.length < 1 || body.length > 300) {
    return redirectAfterPost("/staff/activity?e=bad_request");
  }

  try {
    const result = await withSession(session, (sql) =>
      noteOnLog(sql, org, session.uid, responseId, body)
    );
    if (!result) return redirectAfterPost("/staff/activity?e=not_found");
  } catch (err) {
    console.error(
      "[staff-log-notes] save failed for response",
      responseId,
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/activity?e=save");
  }

  return redirectAfterPost("/staff/activity?noted=1");
}

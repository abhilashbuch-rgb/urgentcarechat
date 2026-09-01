import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { boardTemplatesFor, saveBoardPrefs } from "@/lib/staff/logs";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/logs/board-prefs — one person's own board order and
// visibility. Self-scoped, not admin-gated: every account, from a new
// hire's first shift, may reorder their own list. See
// supabase/staff-board-prefs.sql for why "hidden" can never remove a
// row from what's owed.
//
// A plain form POST, one action per submit (move up/down, hide/show),
// same reason as settings/logs: it works from a phone on the floor and
// the navigation is the feedback. "slug" and one action are the only
// two things read off the request — the order acted on is always read
// back from the database first and recomputed there, never trusted off
// the form.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  const form = await req.formData();
  const slug = String(form.get("slug") ?? "");
  const action = String(form.get("action") ?? "");

  if (!slug || !["up", "down", "hide", "show"].includes(action)) {
    return redirectAfterPost("/staff/logs/customize?e=bad_request");
  }

  try {
    await withSession(session, async (sql) => {
      const me = await getProfile(sql, session.uid);
      const rows = await boardTemplatesFor(sql, me?.job_role ?? null, session.uid);
      const idx = rows.findIndex((r) => r.slug === slug);
      if (idx === -1) return;

      if (action === "hide" || action === "show") {
        rows[idx] = { ...rows[idx], hidden: action === "hide" };
      } else {
        const swapWith = action === "up" ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= rows.length) return;
        [rows[idx], rows[swapWith]] = [rows[swapWith], rows[idx]];
      }

      // Normalizes the whole board to an explicit sequence every time —
      // simpler than tracking gaps, and harmless since a fresh account
      // just falls back to the templates' own sort_order until its
      // first action here.
      await saveBoardPrefs(
        sql,
        org,
        session.uid,
        rows.map((r, i) => ({ slug: r.slug, hidden: r.hidden, sortOrder: i }))
      );
    });
  } catch (err) {
    console.error(
      "[staff-board-prefs] save failed for user",
      session.uid,
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/logs/customize?e=save");
  }

  return redirectAfterPost("/staff/logs/customize?saved=1");
}

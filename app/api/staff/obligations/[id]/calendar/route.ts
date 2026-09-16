import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import { getObligation } from "@/lib/staff/obligations";
import { issueCalendarLink, revokeCalendarLink } from "@/lib/staff/obligation-calendar";

// POST/DELETE /api/staff/obligations/[id]/calendar — issue or revoke a
// subscribable calendar link for one obligation.
//
// MANAGER AND ABOVE, same tier as issuing a surveyor link: this is a
// bearer credential that discloses a due date to whoever holds the URL,
// and deciding who gets handed one is an administrative call.
//
// SCOPED TO THE OBLIGATION'S KEY, NOT ITS ROW ID — see the header of
// supabase/staff-obligation-calendar.sql. The id in the path is only
// used to look up which key this page is about; nothing past that point
// remembers today's row.

export const runtime = "nodejs";

const MAX_LABEL = 80;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolve();
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  const { session, org } = auth.ctx;
  if (!atLeast(session.role, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const label = String(body?.label ?? "").trim().slice(0, MAX_LABEL);
  if (label.length < 3) {
    return NextResponse.json({ error: "label_required" }, { status: 400 });
  }

  return withSession(session, async (sql) => {
    const obligation = await getObligation(sql, id);
    if (!obligation) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const link = await issueCalendarLink(sql, {
      org,
      key: obligation.key,
      label,
      createdBy: session.uid,
    });
    return NextResponse.json({ id: link.id, url: link.url });
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
  const { session } = auth.ctx;
  if (!atLeast(session.role, "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const tokenId = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(tokenId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  return withSession(session, async (sql) => {
    const ok = await revokeCalendarLink(sql, { id: tokenId, by: session.uid });
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  });
}

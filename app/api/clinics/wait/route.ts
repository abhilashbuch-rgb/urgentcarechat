import { NextRequest, NextResponse } from "next/server";
import { getWaitByToken, updateWaitByToken } from "@/lib/wait-time";

// ============================================================
// /api/clinics/wait — current-wait signal for one clinic, keyed by its
// private wait_token (not the read-only analytics_token). Two callers
// use the same POST body shape: the staff self-report page at
// /clinics/wait/[token] (source omitted, defaults to "manual"), and —
// once a clinic has one — a real-time queue vendor's webhook pushing
// updates directly (source: "feed"). Either way, whoever holds the
// token can set the number; there's no separate vendor auth scheme.
// ============================================================

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const wait = await getWaitByToken(token);
  if (!wait) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(wait);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, waitMinutes, source } = body;

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    if (waitMinutes !== null && (typeof waitMinutes !== "number" || waitMinutes < 0 || waitMinutes > 600)) {
      return NextResponse.json({ error: "waitMinutes must be null or 0-600" }, { status: 400 });
    }

    const normalizedSource = source === "feed" ? "feed" : "manual";
    const ok = await updateWaitByToken(token, waitMinutes, normalizedSource);

    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Wait-time update error:", err instanceof Error ? err.message : "Unknown");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

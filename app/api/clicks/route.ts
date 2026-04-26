import { NextRequest, NextResponse } from "next/server";

// ============================================================
// /api/clicks — Analytics endpoint
// Phase 5 will wire this to Supabase.
// For now, just logs to the server console.
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { clinicName, action, sessionId } = body;

    // STUB: Log to console. Phase 5 will insert into Supabase clicks table.
    console.log(
      `[analytics] session=${sessionId} action=${action} clinic=${clinicName}`
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Clicks API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

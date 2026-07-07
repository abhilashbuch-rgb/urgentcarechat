import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import type { SuperbillSnapshot } from "@/lib/superbill";

// ============================================================
// /api/telehealth/superbill — read-only fetch of a patient's
// insurance receipt by its one-time-generated (but not single-use —
// a patient may want to view/print it more than once) token, texted
// to them when their provider submits a visit note with both a
// diagnosis and procedure code. See lib/superbill.ts.
// ============================================================

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const { data: request, error } = await supabase
      .from("telehealth_requests")
      .select("superbill_snapshot, superbill_generated_at")
      .eq("superbill_token", token)
      .maybeSingle();

    if (error || !request || !request.superbill_snapshot) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    }

    const snapshot = request.superbill_snapshot as SuperbillSnapshot;
    return NextResponse.json({ ...snapshot, generatedAt: request.superbill_generated_at });
  } catch (err) {
    console.error("[telehealth/superbill] GET error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

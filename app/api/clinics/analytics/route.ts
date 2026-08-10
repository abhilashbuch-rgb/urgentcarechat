import { NextRequest, NextResponse } from "next/server";
import { getClinicAnalytics } from "@/lib/clinic-analytics";

// ============================================================
// /api/clinics/analytics?token=... — referral numbers for a claimed
// clinic. The analytics_token itself is the credential (a private,
// unguessable link handed to the clinic) — no login required, same
// pattern as the note/superbill tokens the telehealth feature used
// to use. See /clinics/analytics/[token] for the page that renders this.
// ============================================================
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  try {
    const analytics = await getClinicAnalytics(token);
    if (!analytics) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(analytics);
  } catch (err) {
    console.error("Clinic analytics error:", err instanceof Error ? err.message : "Unknown");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

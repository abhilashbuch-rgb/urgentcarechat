import { NextRequest, NextResponse } from "next/server";
import { fetchFluActivity } from "@/lib/cdc-flu";

// GET /api/flu-activity?state=XX — fails soft with level: "unknown" and
// a 200 status rather than erroring, since this is a decorative banner.
export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state") || "PA";
  const activity = await fetchFluActivity(state);
  return NextResponse.json(activity);
}

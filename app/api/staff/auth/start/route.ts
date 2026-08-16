import { NextRequest, NextResponse } from "next/server";
import { authorizeUrl, callbackUrl, isConfigured } from "@/lib/staff/google";
import { isLocalRequest, redirectTo } from "@/lib/staff/http";

// GET /api/staff/auth/start — begin Google sign-in.
//
// Nothing about the patient-triage routes is touched by this file or
// anything it imports, and nothing under /api/chat or /api/clinics imports
// anything from lib/staff. The two sides share a deployment and nothing
// else.

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // No org needed to START sign-in. Which org someone belongs to is a
  // question about them, answered after Google says who they are — not a
  // question about the URL they arrived at.
  if (!isConfigured()) {
    return redirectTo("/staff/signin?e=unconfigured");
  }

  // CSRF: a random value echoed back by Google and compared against a
  // cookie only this browser has. Without it, an attacker can complete the
  // flow in a victim's browser with their own code and silently sign the
  // victim into the attacker's account.
  const state = crypto.randomUUID().replace(/-/g, "");

  // Absolute by necessity — this one leaves our origin entirely.
  const res = NextResponse.redirect(authorizeUrl(callbackUrl(req), state));
  res.cookies.set("uc_staff_state", state, {
    httpOnly: true,
    secure: !isLocalRequest(req),
    sameSite: "lax", // must survive Google's cross-site redirect back
    path: "/api/staff/auth",
    maxAge: 600,
  });
  return res;
}

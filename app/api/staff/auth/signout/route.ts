import { STAFF_COOKIE } from "@/lib/staff/session";
import { redirectAfterPost } from "@/lib/staff/http";

// POST /api/staff/auth/signout — clear the staff session.
//
// POST, not GET: a sign-out on GET can be triggered by any image tag on
// any page, which is a small but real way to make a shared workstation
// mysteriously log people out mid-shift.

export const runtime = "nodejs";

export async function POST() {
  const res = redirectAfterPost("/staff/signin");
  res.cookies.set(STAFF_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

import { NextResponse } from "next/server";

// Redirects that don't guess at their own hostname.
//
// `new URL("/staff", req.url)` looks like the obvious way to build a
// redirect target, and it is wrong here: inside a route handler `req.url`
// carries the server's own origin, not the Host the browser asked for.
// Under `next start` behind a Host header of afc.medicin.io it
// produced `http://localhost:4405/staff/signin` — a Location header
// pointing at the visitor's own machine.
//
// A relative Location is legal (RFC 7231 §7.1.2) and every browser
// resolves it against the request URL, which is exactly the hostname we
// want and the one value we cannot get wrong.

export function redirectTo(path: string, status = 307): NextResponse {
  return new NextResponse(null, { status, headers: { location: path } });
}

/** 303 after a POST, so the browser follows up with a GET instead of
 *  re-posting the form on refresh. */
export function redirectAfterPost(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

/** Whether this request came in over plain HTTP on a developer's machine.
 *  Used only to decide whether cookies may be marked Secure — everywhere
 *  else is https, and a Secure cookie on http://localhost is a cookie the
 *  browser silently drops. */
export function isLocalRequest(req: Request): boolean {
  const host = req.headers.get("host") ?? "";
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

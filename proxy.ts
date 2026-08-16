import { NextResponse, type NextRequest } from "next/server";
import { getTenantBySlug } from "@/lib/tenants";

// ============================================================
// Subdomain routing for branded tenant portals (e.g.
// afc.urgentcare.chat). Root urgentcare.chat and any host that isn't a
// recognized *.urgentcare.chat subdomain pass through untouched — most
// requests (root traffic, local dev, Vercel preview URLs) take this path.
// A recognized subdomain gets its page requests rewritten to /t/[tenant]
// and every request (pages and API alike) tagged with an x-tenant-slug
// header so downstream code can scope data without needing the URL.
// ============================================================

const ROOT_DOMAIN = "urgentcare.chat";

// Paths on the root domain that belong to the main site. A first path
// segment in here is never treated as a tenant slug, so adding a tenant can
// never shadow a real page.
const RESERVED_ROOT_PATHS = new Set([
  "api",
  "t",
  "clinics",
  "disclaimer",
  "monitor",
  "partners",
  "privacy",
  "reads",
  "security",
  "terms",
  "widget",
  "embed",
]);

// Conservative slug shape — also keeps files (anything with a dot, e.g.
// sitemap.xml, robots.txt, llms.txt, favicon.ico) out of tenant lookups.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

// Shared pages that live only on the root domain. Under a tenant subdomain
// these would be rewritten to /t/<slug>/<page>, which doesn't exist, so
// they're redirected to the real page instead of 404ing.
const ROOT_ONLY_PATHS = new Set([
  "reads",
  "monitor",
  "security",
  "privacy",
  "terms",
  "disclaimer",
  "partners",
  "widget",
]);

// Path-based tenant portals on the root domain: urgentcare.chat/afc serves
// the same page as afc.urgentcare.chat.
//
// This is not just a fallback for tenants whose DNS isn't set up yet — it
// means a tenant portal is shareable the moment the row exists, with no
// domain work at all, and it gives every tenant a stable URL that survives
// DNS changes. The subdomain stays the nicer front door.
//
// Cost is bounded: only an unreserved, slug-shaped first segment triggers a
// lookup, and getTenantBySlug caches for a minute, so an unknown path costs
// at most one Supabase read per minute before falling through to the normal
// 404.
async function handleRootDomain(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const [, first, ...rest] = pathname.split("/");

  if (!first || RESERVED_ROOT_PATHS.has(first) || !SLUG_PATTERN.test(first)) {
    return NextResponse.next();
  }

  const tenant = await getTenantBySlug(first);
  if (!tenant) return NextResponse.next();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-slug", tenant.slug);

  const rewrittenUrl = new URL(
    `/t/${tenant.slug}${rest.length ? `/${rest.join("/")}` : ""}`,
    request.url
  );
  rewrittenUrl.search = request.nextUrl.search;

  return NextResponse.rewrite(rewrittenUrl, { request: { headers: requestHeaders } });
}

export async function proxy(request: NextRequest) {
  const hostname = (request.headers.get("host") || "").split(":")[0];

  const isRootDomain = hostname === ROOT_DOMAIN || hostname === `www.${ROOT_DOMAIN}`;
  const subdomain =
    !isRootDomain && hostname.endsWith(`.${ROOT_DOMAIN}`)
      ? hostname.slice(0, -(`.${ROOT_DOMAIN}`.length))
      : null;

  if (!subdomain) {
    return handleRootDomain(request);
  }

  const tenant = await getTenantBySlug(subdomain);

  if (!tenant) {
    // Don't silently serve root content under a name that isn't theirs —
    // send unrecognized/inactive subdomains to the real root domain.
    return NextResponse.redirect(new URL(`https://${ROOT_DOMAIN}`, request.url));
  }

  // Optional access gate for tenant subdomains only — root urgentcare.chat
  // is never affected by this. Vercel's own deployment password protection
  // is project-wide, so it can't gate just afc.urgentcare.chat while
  // leaving the public root page open; this does that instead. Inactive
  // unless TENANT_PREVIEW_KEY is actually set, so a real customer going
  // fully live just needs that env var removed/unset.
  const previewKey = process.env.TENANT_PREVIEW_KEY;
  if (previewKey) {
    const cookieMatches = request.cookies.get("uc_tenant_key")?.value === previewKey;
    const queryKey = request.nextUrl.searchParams.get("key");

    if (!cookieMatches && queryKey === previewKey) {
      const cleanUrl = new URL(request.url);
      cleanUrl.searchParams.delete("key");
      const unlocked = NextResponse.redirect(cleanUrl);
      unlocked.cookies.set("uc_tenant_key", previewKey, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
      return unlocked;
    }

    if (!cookieMatches) {
      return new NextResponse(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Private preview</title></head>
        <body style="font-family:-apple-system,system-ui,sans-serif;max-width:380px;margin:96px auto;text-align:center;color:#1a1a1a;padding:0 20px;">
          <h1 style="font-size:18px;margin-bottom:8px;">Private preview</h1>
          <p style="color:#555;font-size:14px;margin-bottom:20px;">This link needs an access code.</p>
          <form method="GET" style="display:flex;gap:8px;justify-content:center;">
            <input name="key" placeholder="Access code" autofocus style="padding:9px 12px;font-size:14px;border:1px solid #ccc;border-radius:6px;flex:1;max-width:200px;" />
            <button style="padding:9px 16px;font-size:14px;border:none;border-radius:6px;background:#3c3b6e;color:#fff;cursor:pointer;">Enter</button>
          </form>
        </body></html>`,
        { status: 401, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-slug", tenant.slug);

  const { pathname } = request.nextUrl;

  // API routes keep their real path — they read the tenant from the
  // header instead of the URL. Only page requests get rewritten into
  // the tenant-scoped route tree.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // The internal route tree is an implementation detail. If someone lands
  // on it directly under the subdomain — a pasted link, a stale bookmark —
  // send them to the portal root rather than rewriting it a second time
  // into /t/afc/t/afc, which is a 404.
  if (pathname === "/t" || pathname.startsWith("/t/")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Pages that only exist on the root domain. Rewriting them under the
  // tenant prefix produces /t/afc/reads, which doesn't exist, so a
  // franchisee pasting a link to Health Reads got a 404. Send them to the
  // real page instead.
  const firstSegment = pathname.split("/")[1] ?? "";
  if (ROOT_ONLY_PATHS.has(firstSegment)) {
    return NextResponse.redirect(
      new URL(`${pathname}${request.nextUrl.search}`, `https://${ROOT_DOMAIN}`)
    );
  }

  // No trailing slash: at the subdomain root `pathname` is "/", which would
  // make this "/t/afc/". Next normalizes that with a 308 to "/t/afc" — and
  // because the redirect is visible to the browser, the next request comes
  // back through here and gets prefixed AGAIN into /t/afc/t/afc. That is
  // why afc.urgentcare.chat served a 404 the moment DNS started resolving.
  const suffix = pathname === "/" ? "" : pathname;
  const rewrittenUrl = new URL(`/t/${tenant.slug}${suffix}`, request.url);
  rewrittenUrl.search = request.nextUrl.search;

  return NextResponse.rewrite(rewrittenUrl, { request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|opengraph-image.png).*)",
  ],
};

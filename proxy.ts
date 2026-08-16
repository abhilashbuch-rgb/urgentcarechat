import { NextResponse, type NextRequest } from "next/server";
import { getTenantBySlug } from "@/lib/tenants";
import { ROOT_DOMAIN } from "@/lib/site";

// ============================================================
// Subdomain routing for branded tenant portals (e.g.
// afc.urgentcare.chat). Root urgentcare.chat and any host that isn't a
// recognized *.urgentcare.chat subdomain pass through untouched — most
// requests (root traffic, local dev, Vercel preview URLs) take this path.
// A recognized subdomain gets its page requests rewritten to /t/[tenant]
// and every request (pages and API alike) tagged with an x-tenant-slug
// header so downstream code can scope data without needing the URL.
// ============================================================

// Imported rather than declared — see lib/site.ts. The proxy is where
// the domain does the most work, so it is the last place that should
// carry its own copy of the string.

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
  "staff",
  "terms",
  "widget",
  "embed",
]);

// Conservative slug shape — also keeps files (anything with a dot, e.g.
// sitemap.xml, robots.txt, llms.txt, favicon.ico) out of tenant lookups.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

// Tenants whose subdomain is confirmed working — comma-separated slugs in
// TENANT_CANONICAL_SUBDOMAIN_SLUGS, e.g. "afc". Only these redirect from
// urgentcare.chat/<slug> to <slug>.urgentcare.chat.
//
// Per-tenant rather than a single on/off switch, because a subdomain only
// works after someone adds it in Vercel. The wildcard domain cannot issue
// a certificate while DNS lives outside Vercel, so each tenant's subdomain
// is added by hand — and redirecting to one that hasn't been added yet
// would send visitors to a name that doesn't resolve.
//
// Unset means no redirects, which is the safe default: the path URL keeps
// working and nothing breaks.
const CANONICAL_SUBDOMAIN_SLUGS = new Set(
  (process.env.TENANT_CANONICAL_SUBDOMAIN_SLUGS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

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
// Access gate for tenant portals. Inactive unless TENANT_PREVIEW_KEY is
// set, so going fully live means unsetting one env var.
//
// Deliberately applied on BOTH routes a portal is reachable through — the
// subdomain and urgentcare.chat/<slug>. Gating only the subdomain would
// have left the path URL wide open, which is exactly the kind of hole that
// makes a "private preview" not private.
//
// Returns null when the request may proceed.
function tenantGate(request: NextRequest): NextResponse | null {
  const previewKey = process.env.TENANT_PREVIEW_KEY;
  if (!previewKey) return null;

  const cookieMatches = request.cookies.get("uc_tenant_key")?.value === previewKey;
  if (cookieMatches) return null;

  const queryKey = request.nextUrl.searchParams.get("key");
  if (queryKey === previewKey) {
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

// x-tenant-slug is set by this proxy and trusted by everything downstream
// — /api/clinics scopes its search by it, and the staff area resolves
// which organization you are in from it. So it has to be impossible to
// send one: a request arriving with its own x-tenant-slug header must
// have that header removed before any handler can read it.
//
// Without this, `curl -H 'x-tenant-slug: afc'` against the root domain
// would have been enough to make the staff area believe the request
// belonged to an org. The header is only trustworthy because it is
// stripped here first and re-set only after a real lookup.
function baseHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.delete("x-tenant-slug");
  return headers;
}

async function handleRootDomain(request: NextRequest, headers: Headers) {
  const { pathname } = request.nextUrl;
  const [, first, ...rest] = pathname.split("/");

  const passThrough = () => NextResponse.next({ request: { headers } });

  if (!first || RESERVED_ROOT_PATHS.has(first) || !SLUG_PATTERN.test(first)) {
    return passThrough();
  }

  const tenant = await getTenantBySlug(first);
  if (!tenant) return passThrough();

  // The subdomain is the canonical home for a tenant portal, so the path
  // URL redirects to it rather than serving a duplicate. Held back until
  // afc.urgentcare.chat had a valid certificate — redirecting here while
  // HTTPS was failing would have pointed every visitor at a TLS error.
  //
  // The path route still exists and still matters: it is what works on day
  // one for a tenant whose subdomain isn't set up yet, and this redirect
  // only fires for tenants that have one.
  if (CANONICAL_SUBDOMAIN_SLUGS.has(tenant.slug)) {
    const target = new URL(
      `${rest.length ? `/${rest.join("/")}` : "/"}${request.nextUrl.search}`,
      `https://${tenant.slug}.${ROOT_DOMAIN}`
    );
    return NextResponse.redirect(target, 308);
  }

  const gated = tenantGate(request);
  if (gated) return gated;

  headers.set("x-tenant-slug", tenant.slug);

  const rewrittenUrl = new URL(
    `/t/${tenant.slug}${rest.length ? `/${rest.join("/")}` : ""}`,
    request.url
  );
  rewrittenUrl.search = request.nextUrl.search;

  return NextResponse.rewrite(rewrittenUrl, { request: { headers } });
}

export async function proxy(request: NextRequest) {
  const hostname = (request.headers.get("host") || "").split(":")[0];

  const isRootDomain = hostname === ROOT_DOMAIN || hostname === `www.${ROOT_DOMAIN}`;
  const subdomain =
    !isRootDomain && hostname.endsWith(`.${ROOT_DOMAIN}`)
      ? hostname.slice(0, -(`.${ROOT_DOMAIN}`.length))
      : null;

  const requestHeaders = baseHeaders(request);

  if (!subdomain) {
    return handleRootDomain(request, requestHeaders);
  }

  const tenant = await getTenantBySlug(subdomain);

  if (!tenant) {
    // Don't silently serve root content under a name that isn't theirs —
    // send unrecognized/inactive subdomains to the real root domain.
    return NextResponse.redirect(new URL(`https://${ROOT_DOMAIN}`, request.url));
  }

  requestHeaders.set("x-tenant-slug", tenant.slug);

  const { pathname } = request.nextUrl;

  // THERE IS ONE STAFF DOOR, AND IT IS ON THE ROOT DOMAIN.
  //
  // Staff used to sign in at their own org's subdomain, which meant a
  // Google OAuth redirect URI registered by hand for every customer. One
  // address means one callback URL forever, which is the difference
  // between onboarding a customer and provisioning one.
  //
  // Subdomains keep serving the white-label PATIENT portal, where the
  // branding is the whole point. They just don't serve /staff.
  if (
    pathname === "/staff" ||
    pathname.startsWith("/staff/") ||
    pathname.startsWith("/api/staff/")
  ) {
    return NextResponse.redirect(
      new URL(`${pathname}${request.nextUrl.search}`, `https://${ROOT_DOMAIN}`)
    );
  }

  // Same gate as the path route — one implementation, both doors. Still
  // ahead of the API passthrough, so the preview key covers the portal's
  // own data endpoints and not just its HTML.
  const gated = tenantGate(request);
  if (gated) return gated;

  // API routes keep their real path — they read the tenant from the
  // header instead of the URL.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // THE REWRITE RE-ENTERS THIS PROXY. On Vercel (though not under a local
  // `next start`, which is why this passed every local test) the rewritten
  // path comes back through here, so prefixing unconditionally turned "/"
  // into /t/afc and then /t/afc/t/afc — a 404 on the portal root. Making
  // the prefix idempotent is the fix.
  //
  // It must be a pass-through, not a redirect: a redirect here is what
  // turned the 404 into an infinite 307 loop in #20.
  if (pathname === `/t/${tenant.slug}` || pathname.startsWith(`/t/${tenant.slug}/`)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
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

// Where this product lives, and what it is called.
//
// ONE DEFINITION, DELIBERATELY. The domain was hard-coded in six files —
// the proxy, the root layout, robots, the sitemap, the MCP route, and two
// components — which meant "what are we doing about the domain" was a
// refactor rather than a decision. It is now an edit to this file.
//
// The .chat TLD is an ADDRESS, not the product's name. That distinction is
// the point of PRODUCT_NAME existing separately: staff signing compliance
// records should see the thing they are using named, and a URL is not a
// name. Today the two happen to match; the day they don't, only this file
// changes.

/** Bare apex domain. Subdomain routing in proxy.ts keys off this. */
export const ROOT_DOMAIN = "urgentcare.chat";

/** Canonical origin for links, metadata, and sitemaps. */
export const ROOT_URL = `https://${ROOT_DOMAIN}`;

/** The name shown to people. Separate from the domain on purpose. */
export const PRODUCT_NAME = "urgentcare.chat";

/** Who operates it — appears in footers and structured data. */
export const OPERATOR = "Medicin.io LLC";

/** A tenant's canonical address, e.g. afc.urgentcare.chat. */
export function tenantUrl(slug: string): string {
  return `https://${slug}.${ROOT_DOMAIN}`;
}

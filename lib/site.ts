// Where this product lives, and what it is called.
//
// ONE DEFINITION. Everything else imports from here, so moving domains is
// an edit to this file plus DNS.
//
// WHY medicin.io AND NOT urgentcare.chat.
// The compliance platform is not a chat, and by the time a buyer has read
// the homepage, signed up, and put the app on a phone, the word "chat"
// appears exactly once in the whole journey — in the URL — describing
// nothing on any page. It was a good name while the product WAS the
// patient chat. It stopped being one when the product became compliance
// software.
//
// The deciding argument was retention, not branding: compliance records
// are kept for years (OSHA training three, HIPAA documentation six). A
// record printed today with a domain in its footer is a document a
// surveyor may read in 2032, and the cost of moving only ever goes up as
// bookmarks, OAuth clients, receipts and printed records accumulate
// against the old name.

/** Bare apex domain. Subdomain routing in proxy.ts keys off this. */
export const ROOT_DOMAIN = "medicin.io";

/** Canonical origin for links, metadata, and sitemaps. */
export const ROOT_URL = `https://${ROOT_DOMAIN}`;

/** The name shown to people. Separate from the domain on purpose, and
 *  now actually different from it: the product is Medicin Binder, which
 *  lives at medicin.io. Both halves are load-bearing — "binder" is the
 *  thing this replaces, and saying so in the name does more work than a
 *  tagline does. */
export const PRODUCT_NAME = "Medicin Binder";

/** The two halves, for the stacked lockup. Split here rather than in the
 *  component so the mark and the metadata can never disagree about what
 *  the product is called. */
export const PRODUCT_WORDS = ["medicin", "binder"] as const;

/** Who operates it — appears in footers and structured data. */
export const OPERATOR = "Medicin.io LLC";

/**
 * The contact mailbox.
 *
 * On the real domain now — this was the one line the earlier comment
 * here said to change once a mailbox existed on medicin.io, and it now
 * does. It is still not SHOWN anywhere as literal text: every place
 * that prints it uses link text instead, so a typo here breaks a link
 * rather than a sentence on the page.
 */
export const CONTACT_EMAIL = "contact@medicin.io";

/** A mailto with the subject pre-filled, so replies arrive sorted. */
export function contactMailto(subject: string): string {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/**
 * Domains this deployment answers for beyond the current one.
 *
 * EMPTY, DELIBERATELY. urgentcare.chat was kept resolving through the
 * rename so the live AFC patient portal would not break mid-move. It is
 * now retired at the owner's instruction: the product is medicin.io, and
 * a second domain that silently still works is a second domain to keep
 * certificates, redirects and OAuth callbacks straight on forever.
 *
 * CONSEQUENCE, stated plainly because it is not reversible by editing
 * this file alone: afc.urgentcare.chat stops resolving to a portal. Any
 * printed card, QR code or link pointing at it is dead. Point the old
 * domain's DNS at a redirect, or accept the breakage.
 */
export const LEGACY_DOMAINS: readonly string[] = [];

/**
 * Domains that used to serve this product and now only point at it.
 *
 * Different from LEGACY_DOMAINS: a legacy domain SERVES the app, a
 * retired one REDIRECTS to it. Retiring without this list would leave
 * urgentcare.chat rendering a second, unbranded copy of the site — the
 * host is still pointed at the deployment, so "removing" it from the
 * code just makes it an unrecognised host that falls through to the
 * homepage. That is worse than either alternative: two domains serving
 * identical content, neither canonical.
 */
export const RETIRED_DOMAINS = ["urgentcare.chat"] as const;

/** True for a retired domain or any subdomain of one. */
export function isRetiredHost(hostname: string): boolean {
  return RETIRED_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith(`.${d}`)
  );
}

/** True for the apex or www of any domain this deployment answers for. */
export function isRootHost(hostname: string): boolean {
  return [ROOT_DOMAIN, ...LEGACY_DOMAINS].some(
    (d) => hostname === d || hostname === `www.${d}`
  );
}

/** The registrable domain a hostname belongs to, or null if it is not
 *  ours — so a tenant subdomain can be recognised under either name. */
export function domainOf(hostname: string): string | null {
  return (
    [ROOT_DOMAIN, ...LEGACY_DOMAINS].find(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    ) ?? null
  );
}

/** A tenant's canonical address. */
export function tenantUrl(slug: string): string {
  return `https://${slug}.${ROOT_DOMAIN}`;
}

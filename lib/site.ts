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

/** The name shown to people. Separate from the domain on purpose — give
 *  the product a real name and only this line changes. */
export const PRODUCT_NAME = "medicin.io";

/** Who operates it — appears in footers and structured data. */
export const OPERATOR = "Medicin.io LLC";

/**
 * The contact mailbox.
 *
 * Still the old address, because it is a real inbox someone reads and
 * inventing hello@medicin.io here would print a contact address that
 * bounces — worse than an address on the wrong brand. It is no longer
 * SHOWN anywhere: every place that used to print it now uses link text,
 * so the site never says the old name out loud. When a mailbox exists on
 * the new domain, this line is the only edit.
 */
export const CONTACT_EMAIL = "urgentcarechat@icloud.com";

/** A mailto with the subject pre-filled, so replies arrive sorted. */
export function contactMailto(subject: string): string {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/**
 * Domains this deployment still answers for, beyond the current one.
 *
 * urgentcare.chat is NOT retired. It is a genuinely good name for a
 * patient symptom chat, which is what still lives on it: afc.urgentcare.chat
 * is a working white-label patient portal that has been shown to people,
 * and silently breaking it to rename the staff product would be trading
 * someone else's live thing for our tidiness.
 *
 * Tenant subdomains resolve under any of these. The staff area redirects
 * to ROOT_DOMAIN from all of them, so there is still exactly one staff
 * door and one OAuth callback.
 */
export const LEGACY_DOMAINS = ["urgentcare.chat"] as const;

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

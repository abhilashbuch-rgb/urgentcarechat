import { z } from "zod";

// ============================================================
// Per-tenant portal configuration.
//
// A tenant's page is not a fixed copy of the root site — it's assembled
// from this config, stored as `tenants.config` (jsonb). Changing what
// afc.urgentcare.chat looks like is a SQL update, not a deploy.
//
// Everything here arrives from the database, which means it is data, not
// trusted markup. So: no HTML is ever accepted (prose is plain text,
// rendered as paragraphs), URLs are restricted to schemes that can't
// execute (`javascript:` and `data:` are rejected outright), colors must
// be hex, and every string and array is length-capped. A config that
// fails validation falls back to the defaults rather than rendering
// half a page.
// ============================================================

const hex = z
  .string()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, "must be a hex color");

// Absolute http(s), mail/phone, or a same-origin path. Anything else —
// notably javascript: and data: — is rejected, since these strings end up
// in href attributes.
const link = z
  .string()
  .max(500)
  .refine(
    (v) =>
      /^https?:\/\//i.test(v) ||
      /^mailto:/i.test(v) ||
      /^tel:/i.test(v) ||
      v.startsWith("/"),
    { message: "must be http(s), mailto:, tel:, or a root-relative path" }
  );

const linkItem = z.object({
  label: z.string().min(1).max(60),
  href: link,
});

const shortText = z.string().min(1).max(200);
const bodyText = z.string().min(1).max(1200);

// ---------- sections ----------
// Order in the array is the order on the page. A tenant that wants only a
// chat box gets a one-element array; one that wants six blocks gets six.

const chatSection = z.object({
  type: z.literal("chat"),
  headline: z.string().max(140).optional(),
  subhead: z.string().max(500).optional(),
  points: z.array(shortText).max(6).optional(),
  note: z.string().max(300).optional(),
});

const locationsSection = z.object({
  type: z.literal("locations"),
  title: z.string().max(80).optional(),
  subhead: z.string().max(400).optional(),
  /** Cap the list; omit to show every location on file for this tenant. */
  limit: z.number().int().min(1).max(50).optional(),
});

const readsSection = z.object({
  type: z.literal("reads"),
  title: z.string().max(80).optional(),
  subhead: z.string().max(400).optional(),
  count: z.number().int().min(1).max(6).optional(),
  showFluBanner: z.boolean().optional(),
});

const cardsSection = z.object({
  type: z.literal("cards"),
  title: z.string().max(80).optional(),
  subhead: z.string().max(400).optional(),
  cards: z
    .array(
      z.object({
        title: shortText,
        body: bodyText.optional(),
        bullets: z.array(shortText).max(8).optional(),
        link: linkItem.optional(),
      })
    )
    .min(1)
    .max(12),
});

const proseSection = z.object({
  type: z.literal("prose"),
  title: z.string().max(80).optional(),
  /** Plain-text paragraphs. Rendered as <p>, never as markup. */
  paragraphs: z.array(bodyText).min(1).max(12),
});

const faqSection = z.object({
  type: z.literal("faq"),
  title: z.string().max(80).optional(),
  items: z
    .array(z.object({ q: shortText, a: bodyText }))
    .min(1)
    .max(20),
});

const ctaSection = z.object({
  type: z.literal("cta"),
  title: z.string().max(120),
  body: z.string().max(500).optional(),
  buttons: z.array(linkItem).min(1).max(3),
});

const sectionSchema = z.discriminatedUnion("type", [
  chatSection,
  locationsSection,
  readsSection,
  cardsSection,
  proseSection,
  faqSection,
  ctaSection,
]);

export const tenantConfigSchema = z.object({
  // ---------- theme ----------
  theme: z
    .object({
      accent: hex.optional(),
      /** Text/icon color used on top of `accent`. Defaults to white. */
      accentInk: hex.optional(),
      pageBg: hex.optional(),
      headline: z.enum(["serif", "sans"]).optional(),
      radius: z.number().int().min(0).max(28).optional(),
      logoHeight: z.number().int().min(16).max(72).optional(),
    })
    .optional(),

  // ---------- chrome ----------
  navLinks: z.array(linkItem).max(6).optional(),
  navCta: linkItem.optional(),
  phone: z.string().max(24).optional(),
  footerNote: z.string().max(300).optional(),
  footerLinks: z.array(linkItem).max(8).optional(),
  /** Tenants can pay to drop the attribution; default is to show it. */
  showPoweredBy: z.boolean().optional(),

  // ---------- body ----------
  sections: z.array(sectionSchema).min(1).max(12).optional(),
});

export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type TenantSection = z.infer<typeof sectionSchema>;

// A tenant with no config at all still gets a real page: their chat, their
// locations, and health reads. This is what "afc.urgentcare.chat exists"
// means before anyone writes a line of config for them.
export const DEFAULT_CONFIG: TenantConfig = {
  sections: [
    { type: "chat" },
    { type: "locations" },
    { type: "reads", showFluBanner: true },
  ],
};

export function parseTenantConfig(raw: unknown): TenantConfig {
  if (raw == null) return DEFAULT_CONFIG;

  const result = tenantConfigSchema.safeParse(raw);
  if (!result.success) {
    // Loud in logs, silent to the visitor — a typo in one tenant's config
    // must not take their portal down.
    console.error(
      "[tenant-config] invalid config, falling back to defaults:",
      result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")
    );
    return DEFAULT_CONFIG;
  }

  const config = result.data;
  return config.sections?.length ? config : { ...config, sections: DEFAULT_CONFIG.sections };
}

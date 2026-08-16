import Image from "next/image";
import TriageApp from "@/app/components/TriageApp";
import FluBanner from "@/app/components/FluBanner";
import NearestLocation from "@/app/components/NearestLocation";
import { ROOT_URL, PRODUCT_NAME } from "@/lib/site";
import type { Tenant } from "@/lib/tenants";
import type { TenantSection } from "@/lib/tenant-config";
import type { TenantLocation } from "@/lib/tenant-locations";
import type { HealthTopic } from "@/lib/medlineplus";
import { serviceLabel } from "@/lib/service-labels";



export default function TenantPortal({
  tenant,
  locations,
  reads,
}: {
  tenant: Tenant;
  locations: TenantLocation[];
  reads: HealthTopic[];
}) {
  const { config } = tenant;
  const theme = config.theme ?? {};
  const accent = theme.accent ?? tenant.primaryColor ?? "#0f7d84";
  const logoHeight = theme.logoHeight ?? 34;

  // Re-point the shared accent variables at the tenant's color. The deep
  // and soft variants are derived in CSS so a tenant only ever has to
  // supply one hex value.
  const themeVars = {
    "--l-teal": accent,
    "--l-teal-deep": `color-mix(in srgb, ${accent} 76%, #000)`,
    "--l-teal-soft": `color-mix(in srgb, ${accent} 10%, transparent)`,
    "--tp-accent-ink": theme.accentInk ?? "#ffffff",
    ...(theme.pageBg ? { "--l-ground": theme.pageBg } : {}),
    ...(theme.radius != null ? { "--tp-radius": `${theme.radius}px` } : {}),
  } as React.CSSProperties;

  const headlineClass =
    theme.headline === "sans" ? "lp-h1 tp-h1-sans" : "lp-h1";

  // The logo URL comes from the database and is about to be interpolated
  // into a CSS url() — so anything that could terminate the url() or the
  // declaration is rejected rather than escaped. Only a root-relative path
  // or an https URL, and no quotes, parentheses, semicolons, backslashes,
  // or whitespace.
  const watermarkUrl =
    tenant.logoUrl &&
    /^(?:\/|https:\/\/)[^"'()\\;\s]+$/.test(tenant.logoUrl)
      ? tenant.logoUrl
      : null;

  return (
    <div className="lp tp" style={themeVars}>
      {/* Tiled brand watermark across the right half, rotated. Purely
          decorative: aria-hidden and pointer-events:none, behind every
          interactive element, at an opacity low enough that body text
          keeps its contrast ratio. */}
      {watermarkUrl && (
        <div
          className="tp-watermark"
          style={
            { "--tp-watermark-src": `url("${watermarkUrl}")` } as React.CSSProperties
          }
          aria-hidden="true"
        />
      )}

      <header className="lp-nav">
        <div className="lp-nav-inner">
          {tenant.logoUrl ? (
            <Image
              className="tp-logo"
              src={tenant.logoUrl}
              alt={tenant.displayName}
              height={logoHeight}
              width={logoHeight * 6}
              style={{ height: logoHeight, width: "auto" }}
              priority
              unoptimized
            />
          ) : (
            <div className="lp-brand tp-brand-text">
              <span className="tp-brand-dot" aria-hidden="true" />
              {tenant.displayName}
            </div>
          )}

          <nav className="lp-nav-links">
            {config.navLinks?.map((l) => (
              <a key={`${l.label}-${l.href}`} href={l.href}>
                {l.label}
              </a>
            ))}
            {config.phone && (
              <a className="tp-nav-phone" href={`tel:${config.phone}`}>
                {config.phone}
              </a>
            )}
            {config.navCta && (
              <a className="lp-nav-cta" href={config.navCta.href}>
                {config.navCta.label}
              </a>
            )}
          </nav>
        </div>
      </header>

      <main className="lp-main">
        {config.sections?.map((section, i) => (
          <Section
            key={`${section.type}-${i}`}
            section={section}
            tenant={tenant}
            locations={locations}
            reads={reads}
            headlineClass={headlineClass}
          />
        ))}
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-footer-brand">
            {config.footerNote ?? tenant.displayName}
          </span>
          <span className="lp-footer-links">
            {config.footerLinks?.map((l) => (
              <a key={`${l.label}-${l.href}`} href={l.href}>
                {l.label}
              </a>
            ))}
            <a href={`${ROOT_URL}/privacy`}>Privacy</a>
            <a href={`${ROOT_URL}/terms`}>Terms</a>
            {config.showPoweredBy !== false && (
              <a href={ROOT_URL}>Powered by {PRODUCT_NAME}</a>
            )}
          </span>
        </div>
        <p className="lp-footer-note">
          Not a diagnosis tool and not a substitute for emergency care. If you
          are having a medical emergency, call 911.
        </p>
      </footer>
    </div>
  );
}

function Section({
  section,
  tenant,
  locations,
  reads,
  headlineClass,
}: {
  section: TenantSection;
  tenant: Tenant;
  locations: TenantLocation[];
  reads: HealthTopic[];
  headlineClass: string;
}) {
  switch (section.type) {
    case "chat":
      return (
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-eyebrow-dot" aria-hidden="true" />
              {tenant.displayName}
            </span>
            {/* Their closest location, immediately above the headline. */}
            <NearestLocation tenantSlug={tenant.slug} />

            <h1 className={headlineClass}>
              {section.headline ??
                "Tell us what's wrong. We'll point you to the right location."}
            </h1>
            <p className="lp-lede">
              {section.subhead ??
                `Describe what's going on in plain language. It screens for real emergencies first, then routes you to the ${tenant.displayName} location that can help.`}
            </p>
            {section.points && section.points.length > 0 && (
              <ul className="lp-hero-points">
                {section.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <p className="lp-hero-note">
              {section.note ??
                "Not a doctor and not a diagnosis. If this is an emergency, call 911."}
            </p>
          </div>

          <div className="lp-hero-visual">
            <div className="lp-chat-card">
              <TriageApp tenant={tenant} contained />
            </div>
          </div>
        </section>
      );

    case "locations": {
      const shown = section.limit ? locations.slice(0, section.limit) : locations;
      // A tenant with no locations on file gets no empty shell — the
      // section simply isn't there.
      if (shown.length === 0) return null;

      return (
        <section className="lp-section">
          <div className="lp-section-head">
            <div>
              <h2 className="lp-section-title">
                {section.title ?? "Our locations"}
              </h2>
              {section.subhead && (
                <p className="lp-section-sub">{section.subhead}</p>
              )}
            </div>
          </div>
          <div className="tp-loc-grid">
            {shown.map((loc) => (
              <article className="lp-tile tp-loc" key={`${loc.name}-${loc.address}`}>
                <h3>{loc.name}</h3>
                {loc.address && <p className="tp-loc-address">{loc.address}</p>}
                {loc.rating != null && (
                  <p className="tp-loc-rating">
                    <span aria-hidden="true">★</span> {loc.rating.toFixed(1)}{" "}
                    <span className="tp-loc-rating-src">Google rating</span>
                  </p>
                )}
                {loc.services.length > 0 && (
                  <ul className="tp-loc-services">
                    {loc.services.slice(0, 6).map((s) => (
                      <li key={s}>{serviceLabel(s)}</li>
                    ))}
                  </ul>
                )}
                <p className="tp-loc-actions">
                  {loc.phone && <a href={`tel:${loc.phone}`}>Call</a>}
                  {loc.address && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        `${loc.name} ${loc.address}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Directions
                    </a>
                  )}
                  {loc.website && (
                    <a href={loc.website} target="_blank" rel="noopener noreferrer">
                      Website
                    </a>
                  )}
                </p>
              </article>
            ))}
          </div>
        </section>
      );
    }

    case "reads": {
      const shown = reads.slice(0, section.count ?? 3);
      if (shown.length === 0 && !section.showFluBanner) return null;

      return (
        <section className="lp-section">
          <div className="lp-section-head">
            <div>
              <h2 className="lp-section-title">
                {section.title ?? "Health reading"}
              </h2>
              <p className="lp-section-sub">
                {section.subhead ??
                  "Plain-language health topics from the National Library of Medicine, rotating daily. General reading — not advice about your situation."}
              </p>
            </div>
            <a className="lp-section-link" href={`${ROOT_URL}/reads`}>
              See all &rarr;
            </a>
          </div>

          {section.showFluBanner && <FluBanner />}

          {shown.length > 0 && (
            <div className="lp-reads-grid">
              {shown.map((topic) => (
                <article className="lp-tile lp-read-card" key={topic.url}>
                  <h3>{topic.title}</h3>
                  <p>{topic.summary}</p>
                  <p className="lp-tile-link">
                    <a href={topic.url} target="_blank" rel="noopener noreferrer">
                      Read on MedlinePlus &rarr;
                    </a>
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      );
    }

    case "cards":
      return (
        <section className="lp-section">
          <div className="lp-section-head">
            <div>
              {section.title && (
                <h2 className="lp-section-title">{section.title}</h2>
              )}
              {section.subhead && (
                <p className="lp-section-sub">{section.subhead}</p>
              )}
            </div>
          </div>
          <div className="tp-card-grid">
            {section.cards.map((c) => (
              <article className="lp-tile tp-card" key={c.title}>
                <h3>{c.title}</h3>
                {c.body && <p>{c.body}</p>}
                {c.bullets && c.bullets.length > 0 && (
                  <ul className="tp-card-bullets">
                    {c.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {c.link && (
                  <p className="lp-tile-link">
                    <a href={c.link.href}>{c.link.label} &rarr;</a>
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      );

    case "prose":
      return (
        <section className="lp-section tp-prose">
          {section.title && (
            <h2 className="lp-section-title">{section.title}</h2>
          )}
          {section.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      );

    case "faq":
      return (
        <section className="lp-section">
          <div className="lp-section-head">
            <div>
              <h2 className="lp-section-title">
                {section.title ?? "Common questions"}
              </h2>
            </div>
          </div>
          <dl className="tp-faq">
            {section.items.map((item) => (
              <div className="tp-faq-item" key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      );

    case "cta":
      return (
        <section className="lp-section">
          <div className="tp-cta">
            <div>
              <h2 className="tp-cta-title">{section.title}</h2>
              {section.body && <p className="tp-cta-body">{section.body}</p>}
            </div>
            <div className="lp-cta-row">
              {section.buttons.map((b, i) => (
                <a
                  key={`${b.label}-${b.href}`}
                  className={i === 0 ? "tp-btn-accent" : "lp-btn-secondary"}
                  href={b.href}
                >
                  {b.label}
                </a>
              ))}
            </div>
          </div>
        </section>
      );
  }
}

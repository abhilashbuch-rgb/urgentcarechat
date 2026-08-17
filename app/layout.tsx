import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// Self-hosted rather than next/font/google.
//
// next/font/google fetches font files from Google at BUILD time, which
// made every deploy depend on Google being reachable from the build
// container. Three separate deploys failed on exactly that — a
// module-not-found on the generated font CSS for Fraunces, then Inter
// Tight, then Fraunces again — with no code change between them. A build
// that fails at random is worse than a slightly larger repo.
//
// These are the same families, same latin subset, pulled from Google's
// own CDN and committed. Each is the variable font, so the full weight
// range is available from one file per family instead of one per weight.
const interTight = localFont({
  src: "../public/fonts/inter-tight.woff2",
  weight: "100 900",
  variable: "--font-inter-tight",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "../public/fonts/jetbrains-mono.woff2",
  weight: "100 800",
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const fraunces = localFont({
  src: "../public/fonts/fraunces.woff2",
  weight: "100 900",
  variable: "--font-fraunces",
  display: "swap",
});

import { ROOT_URL as SITE_URL, PRODUCT_NAME, OPERATOR } from "@/lib/site";
const SITE_DESCRIPTION =
  "Compliance software for urgent care: daily logs that can't be backdated, staff onboarding with real signatures, and an audit trail nobody can edit. Includes a free patient symptom checker.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${PRODUCT_NAME} — compliance software for urgent care`,
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: `${PRODUCT_NAME} — compliance software for urgent care`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: PRODUCT_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${PRODUCT_NAME} — compliance software for urgent care`,
    description: SITE_DESCRIPTION,
  },
};

// Structured data (schema.org) describing what this site is and who runs
// it — helps search/AI systems represent it accurately instead of
// guessing. Updated when the product became a compliance engine with a
// triage tool attached rather than the other way round. Still explicitly
// a technology company and not a medical practice, consistent with the
// disclaimer copy elsewhere on the site.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: PRODUCT_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      parentOrganization: {
        "@type": "Organization",
        name: OPERATOR,
      },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#webapplication`,
      name: PRODUCT_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any",
      // The patient symptom checker is free and always will be. The staff
      // compliance side is not, so the blanket isAccessibleForFree that
      // used to sit here would now be a false claim about the product.
      featureList: [
        "Digital compliance logs with immutable timestamps",
        "Staff onboarding with electronic signatures",
        "Role-based access with two-step verification",
        "Free patient symptom triage",
      ],
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${jetbrainsMono.variable} ${fraunces.variable}`}
    >
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
        <Analytics />
      </body>
    </html>
  );
}

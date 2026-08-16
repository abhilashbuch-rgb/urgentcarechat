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

const SITE_URL = "https://urgentcare.chat";
const SITE_DESCRIPTION =
  "Free AI-powered symptom triage and urgent care finder. Not a doctor — helps you find the right clinic, right now.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "urgentcare.chat — find care nearby",
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "urgentcare.chat — find care nearby",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "urgentcare.chat",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "urgentcare.chat — find care nearby",
    description: SITE_DESCRIPTION,
  },
};

// Structured data (schema.org) describing what this site is and who runs
// it — helps search/AI systems represent it accurately instead of guessing:
// a free triage tool operated by a technology company, not a medical
// practice, consistent with the disclaimer copy elsewhere on the site.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "urgentcare.chat",
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      parentOrganization: {
        "@type": "Organization",
        name: "Medicin.io LLC",
      },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#webapplication`,
      name: "urgentcare.chat",
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "HealthApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
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

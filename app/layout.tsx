import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// Fraunces is a variable font — load via next/font/google if available,
// but it's an opsz+wght variable font so we use local for reliability.
// Actually Inter_Tight and JetBrains_Mono are straightforward:
const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter-tight",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Fraunces from Google Fonts — it's an optical-size variable font
import { Fraunces } from "next/font/google";
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
      </body>
    </html>
  );
}

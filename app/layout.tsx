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

export const metadata: Metadata = {
  title: "urgentcare.chat — find care nearby",
  description:
    "Free AI-powered symptom triage and urgent care finder. Not a doctor — helps you find the right clinic, right now.",
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
      <body>{children}</body>
    </html>
  );
}

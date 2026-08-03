import type { MetadataRoute } from "next";

const SITE_URL = "https://urgentcare.chat";

// Explicitly allow known AI crawlers/answer-engines alongside standard search
// bots — the default rule already allows everyone, but naming them keeps
// this intentional rather than accidental, and some crawlers are known to
// check for an explicit mention of their own user-agent.
const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "Amazonbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/provider/"],
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: ["/api/", "/provider/"],
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

import type { MetadataRoute } from "next";

import { ROOT_URL as SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/disclaimer`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/partners`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/widget`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    // /reads and /monitor are deliberately absent. Both still work and
    // still resolve for anyone holding a link — they are just no longer
    // advertised. They are a consumer health media property that serves
    // neither the compliance product nor the clinics buying it, and every
    // hour a crawler revalidates them is a MedlinePlus and a CDC fetch
    // paid for by nobody.
    { url: `${SITE_URL}/security`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    // Higher priority than the legal pages: somebody searching for a way
    // to reach this company is much further along than somebody reading
    // the terms.
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/enterprise`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/start`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
  ];
}

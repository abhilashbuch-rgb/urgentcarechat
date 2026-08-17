import type { MetadataRoute } from "next";
import { PRODUCT_NAME } from "@/lib/site";

// Next generates the manifest, rather than a static public/manifest.json,
// so the name and colours come from the same constants as the rest of the
// app and cannot drift from them.
//
// start_url is /staff and NOT the marketing homepage. Somebody who added
// this to their home screen is staff opening it at 7am to run the fridge
// check; sending them to a pricing page would be absurd.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${PRODUCT_NAME} — clinic compliance`,
    short_name: "Compliance",
    description:
      "Daily and per-shift compliance logs for urgent care staff.",
    start_url: "/staff",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#b22234",
    orientation: "portrait",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}

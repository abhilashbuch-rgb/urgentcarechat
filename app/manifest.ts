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
    // The brand's own lowercase form, dot included — it is the domain
    // compressed and it is what the wordmark says everywhere else.
    short_name: "medicin.",
    description:
      "Daily and per-shift compliance logs for clinical staff.",
    start_url: "/staff",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    // --ground from globals.css, exactly. This was #0a2540, a navy from
    // the palette before the identity pass, and it painted the Android
    // status bar and the launch splash a colour that appears nowhere
    // else in the app. A third navy was proposed (#003366) and would
    // have had the same problem. There is one ground colour and this
    // is it.
    theme_color: "#0b1220",
    orientation: "portrait",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}

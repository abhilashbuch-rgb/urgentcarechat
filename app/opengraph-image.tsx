import { ImageResponse } from "next/og";
import { PRODUCT_NAME } from "@/lib/site";

// The card that shows when a link to this site is pasted anywhere.
//
// It used to be a checked-in PNG reading "urgentcare.chat" in 90px type,
// which survived the rename because a rename sweep greps source files and
// a PNG is not a source file. It is now generated from PRODUCT_NAME, so
// the most visible piece of branding on the internet cannot go stale
// again — and the palette is the landing page's, not the bright blue of
// the version this replaced.

export const alt = `${PRODUCT_NAME} — compliance software for urgent care`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0d2436";
const INK_SOFT = "#52697a";
const TEAL = "#0f7d84";
const GROUND = "#f3f7f8";

export default function OpenGraphImage() {
  const dot = PRODUCT_NAME.lastIndexOf(".");
  const stem = dot > 0 ? PRODUCT_NAME.slice(0, dot) : PRODUCT_NAME;
  const tld = dot > 0 ? PRODUCT_NAME.slice(dot) : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: GROUND,
          color: INK,
        }}
      >
        {/* A rule rather than a logo: the existing mark is a speech
            bubble, which is the one thing this product is not. */}
        <div
          style={{
            width: 96,
            height: 8,
            borderRadius: 4,
            background: TEAL,
            marginBottom: 44,
          }}
        />
        <div style={{ display: "flex", fontSize: 92, letterSpacing: -3 }}>
          <span style={{ fontWeight: 700 }}>{stem}</span>
          <span style={{ fontWeight: 700, color: TEAL, fontStyle: "italic" }}>
            {tld}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 40,
            color: INK_SOFT,
            lineHeight: 1.3,
          }}
        >
          Compliance software for urgent care
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 20,
            fontSize: 28,
            color: INK_SOFT,
          }}
        >
          Daily logs that can&rsquo;t be backdated. Signatures that hold up.
        </div>
      </div>
    ),
    size
  );
}

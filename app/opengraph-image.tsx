import { ImageResponse } from "next/og";
import { PRODUCT_WORDS } from "@/lib/site";

// The card that shows when a link to this site is pasted anywhere.
//
// It used to be a checked-in PNG reading "urgentcare.chat" in 90px type,
// which survived the rename because a rename sweep greps source files and
// a PNG is not a source file. It is generated now, so the most visible
// piece of branding on the internet cannot go stale again.
//
// The mark is inlined as a data URI rather than drawn as JSX. next/og
// renders through satori, whose SVG support is narrower than a browser's,
// and a mark that silently degrades in the one image every prospect sees
// before the site is not worth the saving. A data URI is rasterised by
// the same code path as any other image.
//
// Colours are literals, not CSS variables: this renders outside the
// document, so there is no :root to read them from. They are the same
// six values as globals.css and app/icon.svg — if the palette moves,
// all three move together or the card lies about the brand.

export const alt = "medicin. binder — compliance software for urgent care";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0a2540";
const INK_SOFT = "#48678a";
const GOLD_TEXT = "#8a6a17";
const GOLD_DOT = "#c9a227";
const GROUND = "#ffffff";
const RULE = "#dbe7f4";

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
<rect width="48" height="48" fill="#173a8a"/>
<polygon points="9,35 9,13 18.5,13 18.5,35" fill="#d9ab35"/>
<polygon points="18.5,13 24,26 18.5,26" fill="#f2d489"/>
<polygon points="18.5,26 24,26 24,35 18.5,35" fill="#a37c1c"/>
<polygon points="29.5,13 24,26 29.5,26" fill="#a37c1c"/>
<polygon points="24,26 29.5,26 29.5,35 24,35" fill="#f2d489"/>
<polygon points="29.5,13 39,13 39,35 29.5,35" fill="#d9ab35"/></svg>`;

const MARK_SRC = `data:image/svg+xml;base64,${Buffer.from(MARK).toString(
  "base64"
)}`;

export default function OpenGraphImage() {
  const [first, second] = PRODUCT_WORDS;

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
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <img src={MARK_SRC} width={112} height={112} alt="" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 76, fontWeight: 700 }}>
              <span>{first}</span>
              <span style={{ color: GOLD_DOT }}>.</span>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 34,
                fontWeight: 600,
                letterSpacing: 9,
                color: GOLD_TEXT,
                marginTop: 10,
              }}
            >
              {second.toUpperCase()}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            width: 120,
            height: 3,
            background: RULE,
            margin: "52px 0 44px",
          }}
        />

        <div style={{ display: "flex", fontSize: 44, lineHeight: 1.3 }}>
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

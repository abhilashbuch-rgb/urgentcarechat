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

export const alt = "medicin. — compliance software for urgent care";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// THE CARD IS DARK. It is the one image that appears beside a link in
// Slack, iMessage and a search result — surrounded, always, by whatever
// UI is hosting it. A white card dissolves into a white feed; a
// near-black one with a single electric line does not.
const GROUND = "#0b1220";
const INK = "#ffffff";
const INK_SOFT = "rgba(255,255,255,0.68)";
const VOLT = "#22d3ee";
const RULE = "rgba(255,255,255,0.14)";

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
<rect width="48" height="48" rx="10" fill="#131c2e"/>
<path d="M6 27 H12 L18 13 L24 31 L30 13 L36 27 H42" fill="none" stroke="#22d3ee"
 stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// The trace, run long across the foot of the card — the same shape as
// the mark and the same shape the homepage stands on.
const TRACE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 24" preserveAspectRatio="none">
<path d="M0 14 H26 L38 4 L50 21 L62 4 L74 14 H132 L144 4 L156 21 L168 4 L180 14 H240"
 fill="none" stroke="#22d3ee" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const TRACE_SRC = `data:image/svg+xml;base64,${Buffer.from(TRACE).toString(
  "base64"
)}`;

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
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <img src={MARK_SRC} width={112} height={112} alt="" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 76, fontWeight: 700 }}>
              <span>{first}</span>
              <span style={{ color: VOLT }}>.</span>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 34,
                fontWeight: 600,
                letterSpacing: 9,
                color: INK_SOFT,
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
            height: 2,
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

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={TRACE_SRC}
          width={1200}
          height={70}
          alt=""
          style={{ position: "absolute", left: 0, bottom: 0, opacity: 0.85 }}
        />
      </div>
    ),
    size
  );
}

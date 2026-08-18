// The mark: a folded gold M on a royal blue square. Straight edges only.
//
// NO CURVES ANYWHERE — not in the letter, not in the tile, not in the
// joins. Every edge here is a polygon side, so there is no linejoin to
// round by accident.
//
// WHY PLANES AND NOT A STROKE. The previous mark was a single chevron
// stroke: correct, minimal, and read as a real-estate logo, because a
// flat angular M with uniform weight is what estate agencies use. This
// one is the same letter folded out of one ribbon — six faces cut from
// three tones of the same gold, lit as if the fold caught the light.
// Escher's trick, not his impossible geometry: the shape is perfectly
// buildable, but the alternating faces make a flat square read as
// something with depth. The two inner faces swap light and dark across
// the centre line, which is what stops it reading as a simple bevel.
//
// GEOMETRY, so it can be re-derived rather than nudged. Left stem
// x 9→18.5, right stem x 29.5→39, both full height 13→35. The valley
// bottoms at y 26 — deep enough that the middle reads as a vee rather
// than a notch at 16px, which is where a favicon actually lives, and
// shallow enough that the stems stay heavier than the fold.
//
// The medical cross was tried in five positions and every one of them
// fought the letter or turned to mush by 20px. The wordmark beside it
// already says "medicin"; a mark does not have to say "medical" twice.

const GOLD_LIGHT = "var(--gold-100, #f2d489)";
const GOLD_MID = "var(--gold-400, #d9ab35)";
const GOLD_DARK = "var(--gold-600, #a37c1c)";

export default function BrandIcon({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="brand-icon"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="medicin.io"
    >
      <rect width="48" height="48" fill="var(--royal, #173a8a)" />
      <g stroke="none">
        {/* left stem */}
        <polygon points="9,35 9,13 18.5,13 18.5,35" fill={GOLD_MID} />
        {/* inner left: lit face above the fold, shadowed below */}
        <polygon points="18.5,13 24,26 18.5,26" fill={GOLD_LIGHT} />
        <polygon points="18.5,26 24,26 24,35 18.5,35" fill={GOLD_DARK} />
        {/* inner right: the same two faces, swapped — this is the fold */}
        <polygon points="29.5,13 24,26 29.5,26" fill={GOLD_DARK} />
        <polygon points="24,26 29.5,26 29.5,35 24,35" fill={GOLD_LIGHT} />
        {/* right stem */}
        <polygon points="29.5,13 39,13 39,35 29.5,35" fill={GOLD_MID} />
      </g>
    </svg>
  );
}

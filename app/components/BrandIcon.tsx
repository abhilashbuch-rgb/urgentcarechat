// The mark: a cursive capital M in gold, on a royal blue disc, over a
// medical cross.
//
// CURSIVE, AND A CAPITAL. The first attempt drew three arches of equal
// height, which is a lowercase "m" no matter how round the curves are. A
// script capital M is a tall looped first stroke and two shorter arches
// after it, and that difference is the whole legibility of the mark.
//
// The cross sits INSIDE the ring rather than replacing part of it. Broken
// -ring versions read as a damaged seal at small sizes, and a cross
// hanging off the disc edge gets clipped by any circular avatar crop.
//
// Drawn as stroked paths, not set in a script typeface: the mark then
// renders identically at 16px and 512px, needs no font to load before it
// is correct, and cannot silently change the day the brand typeface does.
//
// Checked at 112, 64, 40, 26 and 16px on both the app ground and white.
// At 16px the cross thins out and the M carries the identity, which is
// the right thing to lose first.

export default function BrandIcon({ size = 26 }: { size?: number }) {
  const gold = "var(--gold-300, #e5c158)";
  return (
    <svg
      className="brand-icon"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="medicin.io"
    >
      <circle cx="24" cy="24" r="23" fill="var(--royal, #173a8a)" />
      <circle
        cx="24" cy="24" r="20"
        fill="none" stroke={gold} strokeWidth="1.05" opacity="0.5"
      />
      <g
        fill="none" stroke={gold} strokeWidth="2.9"
        strokeLinecap="round" strokeLinejoin="round"
      >
        {/* tall looped first stroke — what makes it a capital */}
        <path d="M13.6 29.6C12.4 16.8 14.2 9.6 18.3 9.6c3 0 3.4 4.4 1.6 8.6" />
        <path d="M19.9 18.2c-1 2.5-1.4 6.9-1.4 11.4" />
        {/* the two arches */}
        <path d="M18.5 29.6c0-8.2 1.8-12.8 4.7-12.8 2.6 0 3.2 4.2 3.2 12.8" />
        <path d="M26.4 29.6c0-8.2 1.8-12.8 4.7-12.8 2.7 0 3.4 4.6 3 11.4" />
        {/* exit swash */}
        <path d="M34.1 28.2c.2 2 1.2 2.9 2.5 2.5" />
      </g>
      <g stroke={gold} strokeWidth="2.15" strokeLinecap="round">
        <path d="M24 33.6v6" />
        <path d="M21 36.6h6" />
      </g>
    </svg>
  );
}

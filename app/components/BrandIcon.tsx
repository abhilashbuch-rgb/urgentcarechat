// The mark: a gold M on a royal blue square. Straight segments only.
//
// NO CURVES ANYWHERE — not in the letter, not in the tile, not in the
// joins. That means miter joins and butt caps rather than the round ones
// most icon sets default to; a round linejoin on the M's centre vertex
// puts a visible curve at the exact point the eye lands.
//
// The medical cross was tried in five positions — above the M, inside the
// vee, at the baseline, outside a square frame, and as an extension of
// the centre vertex — and every one of them fought the letter or turned
// to mush by 20px. The wordmark next to it already says "medicin"; a mark
// does not have to say "medical" a second time.
//
// Weight was chosen at size, not at scale: a lighter stroke looks more
// refined at 88px and disappears at 16px, which is the size that actually
// matters for a favicon and a home-screen icon.

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
      <path
        d="M12.5 34.5V14l11.5 13.5L35.5 14v20.5"
        fill="none"
        stroke="var(--gold-300, #e5c158)"
        strokeWidth="4.2"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
    </svg>
  );
}

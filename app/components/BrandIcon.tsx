// The mark: a pulse trace whose two peaks are the M.
//
// ONE SHAPE, THREE READINGS. It is the letter the product is named
// after; it is a cardiac trace; and it is the temperature curve this
// system actually draws — the same line that runs across page three of
// every accreditation binder it exports. A mark that means the thing the
// product does beats a mark that merely looks like the industry.
//
// WHAT IT DELIBERATELY IS NOT. Not a cross — every medical vendor owns
// one and none of them own it. Not a caduceus, which is Hermes and the
// wrong symbol regardless of how many US clinics use it. And not an eye:
// the adoption risk for compliance software is staff believing it exists
// to watch them, and an eye on the sign-in screen confirms that fear
// before anybody has read a word.
//
// THE FLAT LEADS MATTER. Without the level segments either side it is a
// zigzag; with them it reads as a strip cut from a longer recording,
// which is what a compliance record is. The centre valley is deep and
// slightly asymmetric for the same reason — a symmetrical W-shape reads
// as decoration, an off-centre downstroke reads as a beat.
//
// Stroke weight scales with the tile: at 16px a 3.6-unit stroke
// disappears into the ground, so it steps up as the mark gets smaller.
// That is deliberate and is why this is a component rather than an
// inlined SVG.

const TRACE = "M6 27 H12 L18 13 L24 31 L30 13 L36 27 H42";

function strokeFor(size: number): number {
  if (size >= 64) return 3.4;
  if (size >= 40) return 4;
  if (size >= 24) return 4.6;
  if (size >= 20) return 5.2;
  return 6;
}

function radiusFor(size: number): number {
  // Proportional, but never so tight it reads as a circle at small
  // sizes nor so loose it reads as a square at large ones.
  return size >= 40 ? 11 : size >= 24 ? 7 : 5;
}

export default function BrandIcon({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="brand-icon"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="medicin."
    >
      <rect
        width="48"
        height="48"
        rx={radiusFor(size)}
        fill="var(--ground, #0b1220)"
      />
      <path
        d={TRACE}
        fill="none"
        stroke="var(--volt, #22d3ee)"
        strokeWidth={strokeFor(size)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The bare trace, for places that draw it at length — a section rule, a
 *  loading state, the top of a dark panel. Exported so the shape lives
 *  in one file. */
export const PULSE_PATH = TRACE;

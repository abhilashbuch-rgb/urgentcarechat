// The mark: a fanned stack of filed sheets, verified.
//
// REPLACES AN EARLIER PULSE-TRACE MARK. That version was the letter M,
// a cardiac trace and a temperature curve all at once — clever on
// paper, but an EKG zigzag is one of the most reused motifs in health
// software, so on a phone's home screen next to a dozen other clinical
// apps it read as generic rather than specific. This mark is the thing
// a clinic actually accumulates — one filed record on top of the last
// — with a check standing for the one fact that matters about the
// pile: somebody can show it was looked at, not just kept.
//
// WHAT IT DELIBERATELY IS NOT, same constraints as before. Not a
// cross — every medical vendor owns one and none of them own it. Not
// a caduceus, which is Hermes and the wrong symbol regardless of how
// many US clinics use it. Not an eye: the adoption risk for compliance
// software is staff believing it exists to watch them.
//
// STROKE ONLY, LIKE EVERY OTHER ICON IN THIS PRODUCT. See
// app/components/staff/NavGroupIcon.tsx and
// app/components/demo/RoleIcon.tsx — one stroke weight, round caps and
// joins, no fill — so a nav glyph, a role glyph and this mark read as
// one system. The one exception is the badge circle, filled with the
// tile's own ground colour rather than left transparent: that is a
// knockout so the check reads cleanly over the sheets behind it, not a
// second colour introduced into the mark.
//
// Stroke weight scales with the tile, same idea as the mark it
// replaces, but far thinner: each bar is only 7.4 units tall on the
// 48-unit grid, so the old mark's 3.4-to-6 range — right for a thin
// zigzag line — reads as a solid filled blob here, not a hollow bar.
// That is deliberate and is why this is a component rather than an
// inlined SVG.

function strokeFor(size: number): number {
  if (size >= 64) return 1.8;
  if (size >= 40) return 2.1;
  if (size >= 24) return 2.4;
  if (size >= 20) return 2.7;
  return 3;
}

function radiusFor(size: number): number {
  // Proportional, but never so tight it reads as a circle at small
  // sizes nor so loose it reads as a square at large ones.
  return size >= 40 ? 11 : size >= 24 ? 7 : 5;
}

export default function BrandIcon({ size = 26 }: { size?: number }) {
  const stroke = strokeFor(size);
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
      {/* The stack — oldest at the back, today's filing on top. */}
      <rect
        x="9" y="28" width="27" height="7.4" rx="3.4"
        fill="none" stroke="var(--volt, #22d3ee)" strokeWidth={stroke} opacity={0.4}
      />
      <rect
        x="11.5" y="20.4" width="25" height="7.4" rx="3.4"
        fill="none" stroke="var(--volt, #22d3ee)" strokeWidth={stroke} opacity={0.7}
      />
      <rect
        x="14" y="12.8" width="23" height="7.4" rx="3.4"
        fill="none" stroke="var(--volt, #22d3ee)" strokeWidth={stroke}
      />
      {/* The badge — that somebody checked, not just that it exists. */}
      <circle
        cx="35.5" cy="33.7" r="8"
        fill="var(--ground, #0b1220)" stroke="var(--volt, #22d3ee)" strokeWidth={stroke * 0.7}
      />
      <path
        d="M32 33.7 L34.3 36 L38.6 30.5"
        fill="none" stroke="var(--volt, #22d3ee)" strokeWidth={stroke * 0.7}
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

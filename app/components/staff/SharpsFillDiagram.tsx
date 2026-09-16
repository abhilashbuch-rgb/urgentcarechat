// A reference diagram for "Any container at or above three-quarters" —
// the one place a fill-level judgment call is hardest to make from text
// alone. Shows the container itself, the three-quarter line staff are
// actually asked about, and which side of that line means "keep using"
// versus "seal it now." The fill animates past the line and back so the
// tipping point itself is what moves, not just decoration — a still
// image can't show a threshold as clearly as watching something cross
// it. Respects prefers-reduced-motion by freezing on the flagged frame,
// the more informative of the two.
export default function SharpsFillDiagram() {
  return (
    <div className="st-sharps-diagram" aria-hidden="true">
      <svg viewBox="0 0 160 200" width="120" height="150">
        {/* Container body — real sharps containers are red by
            convention, and that's also this app's own --danger, so no
            new color token is needed here. */}
        <rect
          x="30" y="40" width="100" height="130" rx="8"
          fill="var(--danger)"
          stroke="#7f1d1d"
          strokeWidth="2"
        />
        {/* Funnel lid */}
        <path
          d="M20 40 L140 40 L118 16 L42 16 Z"
          fill="var(--danger)"
          stroke="#7f1d1d"
          strokeWidth="2"
        />
        <rect x="60" y="10" width="40" height="10" rx="3" fill="#1a2733" opacity=".35" />

        {/* Clipped fill level. y is animated by CSS between "well below
            the line" and "well above it" — the inline y="45" below is
            the flagged frame, so a reduced-motion viewer (the animation
            is disabled for them, not just slowed) still sees the more
            informative of the two states rather than an empty container. */}
        <clipPath id="sharps-body-clip">
          <rect x="30" y="40" width="100" height="130" rx="8" />
        </clipPath>
        <rect
          className="st-sharps-fill"
          x="30" y="45" width="100" height="200"
          clipPath="url(#sharps-body-clip)"
          fill="#fff"
          fillOpacity=".55"
        />

        {/* The three-quarter line itself — 25% empty from the top of a
            130px-tall body starting at y=40, so 40 + 0.25*130 = 72.5. */}
        <line x1="26" y1="72.5" x2="134" y2="72.5" stroke="#fff" strokeWidth="2" strokeDasharray="5 4" />
        <text x="136" y="76.5" fontSize="11" fontWeight="700" fill="var(--ink)">
          3/4
        </text>
      </svg>
      <p className="st-sharps-caption st-sharps-caption-ok">Below the line — keep using it.</p>
      <p className="st-sharps-caption st-sharps-caption-full">At or above the line — seal it and swap it in now.</p>
    </div>
  );
}

// The badge from the brand mark (see BrandIcon.tsx), bare — no tile,
// sized to sit inline next to text that says something was checked: a
// completed log, a reading inside its range. Reuses the same circle +
// check geometry as the mark's own badge so this reads as the same
// idea everywhere it appears, not a second checkmark invented per
// screen. currentColor throughout, same reason as NavGroupIcon and
// RoleIcon — it takes the color of whatever pill or line it sits in.
export default function VerifiedMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="verified-mark"
    >
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6.4 10.2 L8.8 12.6 L13.6 7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

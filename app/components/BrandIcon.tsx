// Small inline mark used next to the "urgentcare.chat" wordmark in every
// header — same design as app/icon.png / app/apple-icon.png / the OG image,
// kept here as JSX so it stays crisp at any size instead of using a raster
// file inline.
export default function BrandIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="brand-icon"
    >
      <rect x="0" y="0" width="100" height="100" rx="22" fill="#2F6FED" />
      <rect x="31.5" y="37" width="13" height="42" rx="5" fill="white" />
      <rect x="17" y="51.5" width="42" height="13" rx="5" fill="white" />
      <rect
        x="42"
        y="14"
        width="46"
        height="34"
        rx="17"
        fill="none"
        stroke="white"
        strokeWidth="6"
      />
      <circle cx="57" cy="31" r="3" fill="white" />
      <circle cx="65" cy="31" r="3" fill="white" />
      <circle cx="73" cy="31" r="3" fill="white" />
    </svg>
  );
}

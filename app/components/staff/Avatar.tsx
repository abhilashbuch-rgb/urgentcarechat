// A staff photo: the face, a ring in the clinic's colour, an optional badge.
//
// THREE LAYERS, NONE OF THEM IN THE FILE. The stored image is the
// cropped face and nothing else — see supabase/staff-avatars.sql. The
// ring and the badge are drawn here from the org's theme, so changing
// affiliation or just a colour is one UPDATE and every avatar in the
// product follows. Burning the frame into the file would mean
// re-processing every photo in every clinic on every rebrand, and would
// leave the old brand living in the bucket forever.
//
// NO PHOTO IS A NORMAL STATE, not a broken one. Initials on the same
// ring, same size, same position — an avatar system whose empty state
// looks like a failed image teaches people the app is broken.

const RING = 3;

export default function Avatar({
  name,
  src,
  brandColor,
  badgeUrl,
  size = 40,
}: {
  /** Legal name where there is one, for the initials and the label. */
  name: string;
  /** Signed URL for the cropped square, or null. */
  src?: string | null;
  brandColor: string;
  badgeUrl?: string | null;
  size?: number;
}) {
  const initials = initialsOf(name);
  const badge = Math.max(14, Math.round(size * 0.34));

  return (
    <span
      className="st-avatar"
      style={{
        width: size,
        height: size,
        // The ring is the brand. Inset rather than a border so the box
        // stays exactly `size` and avatars line up in a list whatever
        // the ring width is.
        boxShadow: `inset 0 0 0 ${RING}px ${brandColor}`,
      }}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="st-avatar-img" src={src} alt="" width={size} height={size} />
      ) : (
        <span
          className="st-avatar-initials"
          style={{ fontSize: Math.round(size * 0.36) }}
          aria-hidden="true"
        >
          {initials}
        </span>
      )}

      {badgeUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="st-avatar-badge"
          src={badgeUrl}
          alt=""
          width={badge}
          height={badge}
          style={{ width: badge, height: badge }}
        />
      )}
    </span>
  );
}

/** First and last initial. Falls back to one letter, then to a dash —
 *  never to an empty circle, which reads as a loading state that never
 *  finishes. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "–";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (
    parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)
  ).toUpperCase();
}

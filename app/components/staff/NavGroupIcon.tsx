// The five marks in the staff drawer: Today plus the four groups.
//
// SAME HAND AS RoleIcon AND BrandIcon — one stroke weight, round caps and
// joins, no fill, currentColor throughout, so a set of unrelated subjects
// reads as one system rather than five icons picked from a library. See
// app/components/demo/RoleIcon.tsx for the fuller version of this
// argument; this file exists because that one is demo-only and these
// five needed to be small enough to sit inline with 14px nav text.
//
// EACH ONE IS THE THING THE GROUP ACTUALLY HOLDS. The clock is what's
// due right now. The clipboard is the shift's own paperwork. The badge
// is one person's record. The building is the facility a centre admin
// is answering for. The sliders are the settings only an owner touches —
// not a gear, because a gear promises "configuration" in general and
// Administer is four specific, named things.

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="st-nav-icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Today — the dashboard, what's due right now. */
function IconClock() {
  return (
    <Frame>
      <circle {...S} cx="12" cy="12.5" r="8.3" />
      <path {...S} d="M12 8v4.7l3.3 2" />
    </Frame>
  );
}

/** My shift — the clipboard filled in on the floor. */
function IconClipboard() {
  return (
    <Frame>
      <rect {...S} x="5.5" y="4.3" width="13" height="16.4" rx="2" />
      <rect {...S} x="9" y="2.5" width="6" height="3.2" rx="1" />
      <path {...S} d="M8.7 12.6l2 2 4.4-4.6" />
    </Frame>
  );
}

/** My record — one person's own shelf. */
function IconBadge() {
  return (
    <Frame>
      <circle {...S} cx="12" cy="9.3" r="3" />
      <path {...S} d="M6 19c.9-3.3 3.2-5.1 6-5.1s5.1 1.8 6 5.1" />
    </Frame>
  );
}

/** Run the clinic — the building the centre admin is answering for. */
function IconBuilding() {
  return (
    <Frame>
      <rect {...S} x="5" y="3.2" width="14" height="17.6" rx="1.2" />
      <path {...S} d="M9 7.4h1.6M13.4 7.4H15M9 11.4h1.6M13.4 11.4H15M9 15.4h1.6M13.4 15.4H15" />
      <path {...S} d="M10.3 20.8v-4h3.4v4" />
    </Frame>
  );
}

/** Administer — the settings sliders, deliberately not a gear. */
function IconSliders() {
  return (
    <Frame>
      <path {...S} d="M4 7h8.4M16 7h4" />
      <circle {...S} cx="14.2" cy="7" r="1.9" />
      <path {...S} d="M4 12.5h2.2M9.8 12.5H20" />
      <circle {...S} cx="7.9" cy="12.5" r="1.9" />
      <path {...S} d="M4 18h10.4M18.6 18H20" />
      <circle {...S} cx="16.4" cy="18" r="1.9" />
    </Frame>
  );
}

export const NAV_ICONS = {
  today: IconClock,
  shift: IconClipboard,
  record: IconBadge,
  clinic: IconBuilding,
  admin: IconSliders,
} as const;

export type NavIconId = keyof typeof NAV_ICONS;

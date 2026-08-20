// The four role marks on /demo.
//
// DRAWN IN THE SAME HAND AS THE LOGO, which is the whole reason these
// replaced emoji. An emoji is somebody else's artwork — it renders as
// Apple's glyph on one machine and Google's on the next, it carries a
// cartoon weight no other element on the page has, and at 22px beside
// 15px type it is the loudest thing on a screen selling recordkeeping.
//
// So: one viewBox, one stroke weight, round caps and joins, no fill, and
// currentColor throughout so each icon takes the colour of the card it
// sits in. Same construction as BrandIcon — a line on a grid — which is
// what makes four unrelated subjects read as one set.
//
// EACH ONE IS THE THING THE ROLE ACTUALLY TOUCHES, not a mascot for it:
// the thermometer is the fridge check, the trace is the emergency guide,
// the card is the credential shelf, the sheet is the inspection vault.

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="demo-role-icon"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Medical assistant — the fridge thermometer they tap twice a shift. */
export function IconThermometer() {
  return (
    <Frame>
      <path {...S} d="M10 13.6V4.5a2 2 0 1 1 4 0v9.1" />
      <path {...S} d="M12 13.9a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z" />
      <path {...S} d="M16.6 6.5h2.6M16.6 9.5h1.6" />
    </Frame>
  );
}

/** Provider — the emergency guide, every step of the trace at once. */
export function IconTrace() {
  return (
    <Frame>
      <path {...S} d="M2.5 12h3.6l2.2-5.2 3.1 10.4 2.3-7 1.7 4.2h6.1" />
    </Frame>
  );
}

/** Any staff member — the credential card with its expiry. */
export function IconCard() {
  return (
    <Frame>
      <rect {...S} x="2.5" y="5" width="19" height="14" rx="2.4" />
      <path {...S} d="M8.4 11.6a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z" />
      <path {...S} d="M5.6 15.6c.5-1.5 1.6-2.3 2.8-2.3s2.3.8 2.8 2.3" />
      <path {...S} d="M14.6 10h4.2M14.6 13.4h4.2M14.6 16h2.6" />
    </Frame>
  );
}

/** Surveyor / owner — the record, read and not written. */
export function IconVault() {
  return (
    <Frame>
      <path {...S} d="M5.5 2.8h9.2l4.3 4.3v14.1H5.5z" />
      <path {...S} d="M14.3 2.9v4.4h4.5" />
      <path {...S} d="M8.4 12.2h4.2M8.4 15.3h3" />
      <path {...S} d="M15.1 16.4a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm1.9 1.8-1-1" />
    </Frame>
  );
}

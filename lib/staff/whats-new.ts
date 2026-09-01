// The one active "what's new" note on the Today screen, if it's still
// worth showing.
//
// A CURRENT NOTE, NOT A FEED. There is only ever one entry — the most
// recently shipped change a shift would actually care about — because
// nobody standing at a fridge at 7am is going to scroll a changelog. No
// terms, no legal copy: that already happened at onboarding, and an
// employee re-reading it here would just start ignoring this callout
// entirely, taking the next real one down with it.
//
// SELF-EXPIRING, ON PURPOSE. currentAnnouncement() stops returning this
// once WINDOW_DAYS have passed since `date`, so a note nobody acts on
// doesn't sit on the screen forever turning into wallpaper. Shipping the
// next update means replacing the fields below, not appending to a list.

interface Announcement {
  date: string; // YYYY-MM-DD, the day this shipped
  title: string;
  blurb: string;
  href: string;
  cta: string;
}

const CURRENT: Announcement = {
  date: "2026-09-01",
  title: "You can now set up your own board",
  blurb:
    "Put today's logs in the order you actually work, and hide the ones you rarely need. Anything hidden is still tracked — it just stays out of your way.",
  href: "/staff/logs/customize",
  cta: "Set it up",
};

const WINDOW_DAYS = 21;

export function currentAnnouncement(): Announcement | null {
  const shippedAt = new Date(`${CURRENT.date}T00:00:00Z`).getTime();
  const ageDays = (Date.now() - shippedAt) / 86_400_000;
  if (ageDays < 0 || ageDays > WINDOW_DAYS) return null;
  return CURRENT;
}

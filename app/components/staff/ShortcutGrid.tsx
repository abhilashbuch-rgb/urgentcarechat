import Link from "next/link";
import type { NavItem } from "@/lib/staff/roles";
import { NAV_ICONS } from "@/app/components/staff/NavGroupIcon";

// One tap instead of two. The drawer nav collapses everything into five
// groups on purpose — see the NavGroup comment in lib/staff/roles.ts —
// but collapsed is the wrong shape for the handful of things an
// administrator actually reaches every day. This is the same items,
// same permission filtering, laid out as square tiles instead of
// nested behind a menu and a group toggle.
//
// SAME LIST, NOT A SEPARATE ONE. Built from navFor()'s own output
// rather than a hand-picked shortlist, so a tile can never offer
// something the nav itself would refuse, and adding a nav item never
// means remembering to also add a tile.
//
// NO PLACEHOLDER TILES. "Review" is inert everywhere else in the nav
// (see st-nav-soon) and would be a square that does nothing here too —
// worse on a homepage, where every tile implies "tap this."
export default function ShortcutGrid({ items }: { items: NavItem[] }) {
  const tiles = items.filter((item) => item.group && !item.placeholder);
  if (tiles.length === 0) return null;

  return (
    <div className="st-shortcuts">
      {tiles.map((item) => {
        const Icon = NAV_ICONS[item.group!];
        return (
          <Link key={item.href} className="st-shortcut-tile" href={item.href}>
            <Icon />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

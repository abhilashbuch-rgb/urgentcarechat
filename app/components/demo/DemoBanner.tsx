import Link from "next/link";

// Every demo screen says this, at the top, in the same words. A buyer
// clicking through four tabs should never have to wonder on tab three
// whether this one is real or whether tapping something files an actual
// record against a real clinic — it should be unmistakable on every
// single screen, not just the first.

export default function DemoBanner({ role }: { role: string }) {
  return (
    <div className="demo-banner" role="status">
      <span className="demo-banner-tag">Demo</span>
      <span>
        Sample data for <strong>{role}</strong>. Nothing on this screen is
        saved, and no account is required.
      </span>
      <Link href="/demo" className="demo-banner-switch">
        Switch role
      </Link>
    </div>
  );
}

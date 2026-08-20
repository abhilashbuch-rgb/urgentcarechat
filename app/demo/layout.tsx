import type { Metadata } from "next";

// The demo tree is deliberately outside /staff. It carries no session,
// touches no database, and calls no API route — every screen under here
// is a fixture rendered from a literal object in the page file. That is
// what makes it safe to put behind no login at all: there is nothing
// underneath it to write to, and nothing a visitor does here can reach a
// real clinic's records.
//
// Not indexed. It is a sales tool handed out as a link, not a page
// meant to outrank the real product in search.

export const metadata: Metadata = {
  title: "Live demo",
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <div className="st demo-root">{children}</div>;
}

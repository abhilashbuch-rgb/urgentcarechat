import type { Metadata } from "next";

// The demo tree is deliberately outside /staff. It carries no session,
// touches no database, and calls no API route — every screen under here
// is a fixture rendered from a literal object in the page file. That is
// what makes it safe to put behind no login at all: there is nothing
// underneath it to write to, and nothing a visitor does here can reach a
// real clinic's records.
//
// NOINDEX BY DEFAULT, FOLLOW ALWAYS.
//
// The default for this tree is still "do not index": a configured board
// exists in as many variants as there are combinations of switches, and
// a crawler is not the audience for any of them.
//
// But follow is now true, where it used to be false. These pages link to
// /start, /contact and the wizard, and nofollow threw all of that away
// for no benefit — the reason not to index a page is that it is a poor
// search result, which says nothing about the pages it points at.
//
// /demo itself overrides this and IS indexed. It is the page that
// answers "does this fit a clinic like mine", which is a question people
// type into a search box.

export const metadata: Metadata = {
  title: "Live demo",
  robots: { index: false, follow: true },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <div className="st demo-root">{children}</div>;
}

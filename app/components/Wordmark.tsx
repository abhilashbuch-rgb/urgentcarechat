import { PRODUCT_WORDS } from "@/lib/site";

// The wordmark: "medicin" over "binder", stacked.
//
// Two lines rather than one because the second word is the whole pitch —
// this replaces a paper binder — and setting it inline turns it into a
// surname nobody reads. Stacked, letterspaced and in gold, it reads as a
// descriptor, which is what it is.
//
// Derived from PRODUCT_WORDS rather than typed here, so the mark and the
// page titles cannot end up calling the product two different things.
//
// The whole lockup is one flex column inside one element: the header rows
// that hold it are themselves flex with a gap, and a bare text node
// beside a span becomes a second flex item, which is what put 8px of air
// inside the previous wordmark.
//
// The gold full stop is the domain, compressed. "medicin." is a word the
// eye finishes as medicin.io without the site having to print a URL in
// its own logo, and in gold it ties the mark's colour into the type
// instead of leaving the gold stranded on the square. aria-hidden so a
// screen reader says "medicin binder" and not "medicin dot binder" —
// it is punctuation doing a picture's job, and there is nothing in it
// to read aloud.

// A regulatory-descriptor variant of the second line, for the screens a
// buyer or a brand-new hire reaches before anything else has told them
// what this is — the sign-in card, not the marketing header, which
// already spends a whole hero explaining it in specific, concrete terms.
// Kept out of the compact nav lockup on purpose: at 10px letterspaced
// caps this line is roughly four times as wide as "BINDER", and the top
// nav has no room to wrap it without the same overflow bugs this brand
// pass already spent a session hunting down.
const REGULATORY_TAGLINE = "Clinical safety & regulatory infrastructure";

export default function Wordmark({
  size = "sm",
  tagline = false,
}: {
  size?: "sm" | "lg";
  tagline?: boolean;
}) {
  const [first, second] = PRODUCT_WORDS;
  return (
    <span className={`wordmark wordmark-${size}`}>
      <span className="wordmark-1">
        {first}
        <span className="wordmark-dot" aria-hidden="true">
          .
        </span>
      </span>
      <span className="wordmark-2">{tagline ? REGULATORY_TAGLINE : second}</span>
    </span>
  );
}

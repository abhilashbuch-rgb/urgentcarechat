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

export default function Wordmark({ size = "sm" }: { size?: "sm" | "lg" }) {
  const [first, second] = PRODUCT_WORDS;
  return (
    <span className={`wordmark wordmark-${size}`}>
      <span className="wordmark-1">
        {first}
        <span className="wordmark-dot" aria-hidden="true">
          .
        </span>
      </span>
      <span className="wordmark-2">{second}</span>
    </span>
  );
}

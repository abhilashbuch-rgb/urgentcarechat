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

export default function Wordmark({ size = "sm" }: { size?: "sm" | "lg" }) {
  const [first, second] = PRODUCT_WORDS;
  return (
    <span className={`wordmark wordmark-${size}`}>
      <span className="wordmark-1">{first}</span>
      <span className="wordmark-2">{second}</span>
    </span>
  );
}

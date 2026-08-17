import { PRODUCT_NAME } from "@/lib/site";

// The wordmark, split so the TLD can be styled differently from the name.
//
// Derived from PRODUCT_NAME rather than written out, because it was
// written out on eleven pages and a rename left three of them still
// saying the old domain. One definition in lib/site.ts, one component
// that renders it.
//
// `tldClass` exists only because the landing pages and the app pages
// style the TLD with different classes; everything else about the mark is
// the same.

export default function Wordmark({ tldClass = "tld" }: { tldClass?: string }) {
  const dot = PRODUCT_NAME.lastIndexOf(".");
  if (dot < 1) return <span className="wordmark">{PRODUCT_NAME}</span>;
  return (
    // Wrapped in one element rather than returned as a fragment. The
    // headers that hold the mark are flex containers with a gap, and a
    // bare text node beside a span is TWO flex items — which put 8px of
    // air inside the wordmark and rendered it as "medicin .io".
    <span className="wordmark">
      {PRODUCT_NAME.slice(0, dot)}
      <span className={tldClass}>{PRODUCT_NAME.slice(dot)}</span>
    </span>
  );
}

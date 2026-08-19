import BrandIcon from "@/app/components/BrandIcon";
import Wordmark from "@/app/components/Wordmark";

// THE lockup. The mark and the wordmark, at one size, everywhere.
//
// WHY THIS EXISTS. The two halves were composed by hand at every call
// site — twenty-one of them — which meant the icon was rendered at 22,
// 26, 28 and the default depending on the file, and the staff header had
// drifted to the icon ALONE with the clinic's name where the wordmark
// should be. So the product looked like one brand on the marketing site
// and a different one once you signed in, which is the thing a lockup
// exists to prevent.
//
// It takes no size prop on purpose. A size argument is how the previous
// drift happened: every call site got to decide, and over a few months
// they decided differently. If a particular screen needs the mark to
// carry more weight, that is a spacing and hierarchy problem on that
// screen, not a reason for a second logo.
//
// The one variant is `tagline`, which swaps the wordmark's second line
// for the regulatory descriptor. It exists for the signed-out front door
// — the one screen a buyer or a new hire reaches before anything else
// has told them what this is.

export default function BrandLockup({ tagline = false }: { tagline?: boolean }) {
  return (
    <span className="brand-lockup">
      <BrandIcon size={26} />
      <Wordmark tagline={tagline} />
    </span>
  );
}

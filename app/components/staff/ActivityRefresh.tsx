"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// router.refresh() rather than location.reload(): it re-runs the server
// component and swaps the payload in, so the page does not flash white
// and the scroll position survives. An administrator watching the board
// during a morning shift should not be thrown to the top every twenty
// seconds.
//
// PAUSED WHEN THE TAB IS HIDDEN. A board left open on a back-office
// machine overnight would otherwise poll ~4,300 times before anybody
// looked at it.
export default function ActivityRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);

    // Catch up immediately on return rather than waiting out the
    // remainder of an interval that elapsed while the tab was hidden.
    const onShow = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onShow);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [router, seconds]);

  return null;
}

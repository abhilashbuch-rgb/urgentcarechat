"use client";

import { useState } from "react";

// Browsers stopped letting a page trigger the native "add bookmark"
// dialog itself years ago (it was a spam vector) — there is no API for
// it in any current browser. The honest version of this button is not
// "bookmarks the page" but "tells you the two-key shortcut that does,"
// picked for the platform actually reading this.
export default function BookmarkButton() {
  const [hint, setHint] = useState<string | null>(null);

  return (
    <div className="mh-bookmark">
      <button
        type="button"
        className="mh-cta"
        onClick={() => {
          const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
          setHint(
            isMac
              ? "Press ⌘D to bookmark this page"
              : "Press Ctrl+D to bookmark this page"
          );
        }}
      >
        Bookmark this page
      </button>
      {hint && <p className="mh-bookmark-hint">{hint}</p>}
    </div>
  );
}

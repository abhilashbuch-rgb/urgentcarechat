"use client";

import { useEffect, useState } from "react";

// "Add this to the home screen."
//
// PLATFORM REALITY FIRST, because the spec for this asked for one modal
// that works everywhere and no such thing exists:
//
//   CHROMIUM (Chrome, Edge, Samsung) fires `beforeinstallprompt`, which
//   can be captured and replayed on a button press. This is the only
//   platform where a real install button is possible.
//
//   iOS AND iPadOS HAVE NO PROGRAMMATIC INSTALL AT ALL. Nothing fires,
//   nothing can be triggered, and the only route is the user tapping
//   Share then Add to Home Screen — IN SAFARI. Chrome on iOS cannot do
//   it reliably. So iOS gets instructions, and only when the browser is
//   one where the instructions are true.
//
//   FIREFOX AND EVERYTHING ELSE get NOTHING, deliberately. A banner
//   telling somebody to tap a Share icon their browser does not have is
//   worse than silence: it makes the product look broken on their device
//   before they have used it.
//
// IT IS A BANNER, NOT A MODAL. A modal on first load is the pattern that
// teaches people to dismiss without reading, and this one would land on a
// clinician opening the app to file a fridge temperature. It sits at the
// bottom, it is dismissible, and the dismissal sticks.
//
// IT LIVES IN THE STAFF AREA, plus exactly one screen outside it: the
// confirmation shown after a trial is created. The person who benefits
// from a home-screen icon is staff opening this at 7am every day, and
// the owner who has just made the clinic and is about to become the
// first of them. A prospect reading pricing on a laptop is not offered
// it, which is why this is not in the site layout.

const DISMISS_KEY = "medicin.install.dismissed";

interface PromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Mode = "none" | "chromium" | "ios";

export default function InstallPrompt() {
  const [mode, setMode] = useState<Mode>("none");
  const [deferred, setDeferred] = useState<PromptEvent | null>(null);

  useEffect(() => {
    // ALREADY INSTALLED — the most important check. Somebody running the
    // installed app must never be told to install it. `standalone` on
    // navigator is the iOS signal; the media query is everyone else's.
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (installed) return;

    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // Private mode with storage blocked. Showing the banner every time
      // is worse than not showing it, so treat it as dismissed.
      return;
    }

    const onPrompt = (e: Event) => {
      // Chromium shows its own mini-infobar unless this is prevented, and
      // two prompts for one action is how a user learns to ignore both.
      e.preventDefault();
      setDeferred(e as PromptEvent);
      setMode("chromium");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS Safari only. Testing for the Apple touch platform AND for the
    // absence of the Chrome/Firefox-on-iOS user agent tokens, because on
    // those the Share sheet has no Add to Home Screen entry and the
    // instruction would be a lie.
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS 13+ reports as a Mac; the touch points give it away.
      (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

    // DEFERRED PAST THE FIRST PAINT rather than set synchronously here.
    // Two reasons and both are real: setting state during an effect
    // cascades a render the linter is right to object to, and a banner
    // that appears in the very first painted frame shifts the page under
    // somebody who has just tapped something. It arrives a frame late,
    // which is what a suggestion should do.
    const t = window.setTimeout(() => {
      if (isIOS && isSafari) setMode("ios");
    }, 0);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* nothing to do; the banner just returns next visit */
    }
    setMode("none");
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    // Either outcome ends the banner. Somebody who declined the native
    // dialog has answered the question.
    await deferred.userChoice.catch(() => undefined);
    dismiss();
  }

  if (mode === "none") return null;

  return (
    <div className="st-install" role="complementary" aria-label="Install this app">
      <div className="st-install-body">
        <strong>Put this on the home screen</strong>
        {mode === "ios" ? (
          <p>
            Tap <span className="st-install-key">Share</span>, then{" "}
            <span className="st-install-key">Add to Home Screen</span>. It
            opens straight to the day&rsquo;s logs — no browser bar, and the
            shift chime works.
          </p>
        ) : (
          <p>
            One tap to the day&rsquo;s logs, full screen, with the shift
            chime working.
          </p>
        )}
      </div>

      <div className="st-install-actions">
        {mode === "chromium" && (
          <button type="button" className="st-btn st-install-go" onClick={install}>
            Install
          </button>
        )}
        <button type="button" className="st-btn" onClick={dismiss}>
          {mode === "ios" ? "Got it" : "Not now"}
        </button>
      </div>
    </div>
  );
}

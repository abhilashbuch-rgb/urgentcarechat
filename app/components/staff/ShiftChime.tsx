"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chime } from "@/lib/audio/chime";

// The shift reminder: a soft chime and a browser notification when
// something the person's job owns is due and not done.
//
// TIME-GATED IN THE CLINIC'S ZONE, ON THE SERVER. The check is not "is
// it between 07:30 and 20:30 on this device" — a phone set to the wrong
// timezone, or a nurse checking the app from a holiday, would then get
// reminders at the wrong hour or none at all. The poll returns whether
// the CLINIC is open, computed in the clinic's own IANA zone by
// staff.within_operating_hours(). Off-shift devices stay silent, which
// is a labour-law point as much as a courtesy one.
//
// AUDIO MUST BE UNLOCKED BY A REAL GESTURE. Every browser starts an
// AudioContext suspended, and one created on page load then resumed from
// a timer stays silent with no error at all — the single most common way
// a web chime ships broken. So the first click anywhere on the page
// unlocks it, once.
//
// POLLING, NOT A SOCKET. One request every three minutes against a
// question whose answer changes on the scale of hours. A websocket for
// this would be a persistent connection per device per shift to learn
// something a cheap poll already tells us, on clinic wifi that drops.

const POLL_MS = 3 * 60 * 1000;

interface Pending {
  open: boolean;
  due: { slug: string; slot: string; name: string; late: boolean }[];
}

export default function ShiftChime({
  audioEnabled,
}: {
  audioEnabled: boolean;
}) {
  const [on, setOn] = useState(audioEnabled);
  const [ready, setReady] = useState(false);
  // Which task slugs have already been announced this session. Without
  // this, an unfinished task chimes every three minutes until somebody
  // does it, which is how people learn to switch the sound off.
  const announced = useRef<Set<string>>(new Set());

  // THE FIRST GESTURE OF ANY KIND UNLOCKS AUDIO, whatever it is.
  //
  // Every browser starts an AudioContext suspended and only a genuine
  // user gesture may resume it; one created on page load and resumed
  // from a timer stays silent with no error at all. Binding to
  // pointerdown alone misses the keyboard user who tabs to a link and
  // presses Enter, and misses a touch that is handled as touchend
  // without a pointer event on older iOS.
  //
  // So all three are bound, whichever fires first wins, and the rest are
  // torn down together. capture:true means a handler that calls
  // stopPropagation somewhere in the tree cannot silently prevent the
  // unlock.
  useEffect(() => {
    const events = ["pointerdown", "keydown", "touchend"] as const;
    const unlock = () => {
      chime.unlock();
      setReady(chime.ready);
      for (const e of events) window.removeEventListener(e, unlock, true);
    };
    for (const e of events) {
      window.addEventListener(e, unlock, { capture: true, once: true });
    }
    return () => {
      for (const e of events) window.removeEventListener(e, unlock, true);
    };
  }, []);

  const poll = useCallback(async () => {
    const res = await fetch("/api/staff/pending", { cache: "no-store" }).catch(
      () => null
    );
    if (!res?.ok) return;
    const data: Pending = await res.json();
    // The server decides whether the clinic is open. If it says closed,
    // nothing sounds — regardless of what this device's clock thinks.
    if (!data.open) return;

    // Keyed by slug AND slot: the morning narcotics count and the
    // evening one are the same template and two different tasks, and
    // announcing on slug alone would silence the second one.
    const key = (d: { slug: string; slot: string }) => `${d.slug}:${d.slot}`;
    const fresh = data.due.filter(
      (d) => d.late && !announced.current.has(key(d))
    );
    if (fresh.length === 0) return;
    for (const d of fresh) announced.current.add(key(d));

    if (on) chime.play();

    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      new Notification(
        fresh.length === 1
          ? `${fresh[0].name} (${fresh[0].slot.toUpperCase()}) is due`
          : `${fresh.length} tasks due`,
        {
          body: fresh
            .map((d) => `${d.name} (${d.slot.toUpperCase()})`)
            .join(", "),
          tag: "medicin-shift",
        }
      );
    }
  }, [on]);

  useEffect(() => {
    const id = setInterval(poll, POLL_MS);
    // One immediate poll so somebody arriving mid-shift is not waiting
    // three minutes to learn the morning fridge check is outstanding.
    void poll();
    return () => clearInterval(id);
  }, [poll]);

  async function toggle() {
    const next = !on;
    setOn(next);
    if (next) {
      chime.unlock();
      setReady(chime.ready);
      chime.play(); // Confirm it audibly. A toggle that claims to be on
      // without making a sound is a toggle nobody trusts.
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        void Notification.requestPermission();
      }
    }
    await fetch("/api/staff/pending", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio_alerts_enabled: next }),
    }).catch(() => null);
  }

  return (
    <button
      className={`st-chime${on ? " st-chime-on" : ""}`}
      onClick={toggle}
      title={
        on
          ? "Shift reminders will chime during clinic hours"
          : "Sound is off — you will still see reminders on screen"
      }
      aria-pressed={on}
    >
      <span aria-hidden="true">{on ? "🔔" : "🔕"}</span>
      <span className="st-chime-label">{on ? "Sound on" : "Sound off"}</span>
      {/* Said once, quietly, rather than nagged. The recommendation is
          real — a reminder nobody hears is a reminder that did not
          happen — but a persistent warning banner over a deliberate
          choice is just noise. */}
      {!on && <span className="st-chime-hint">Recommended on</span>}
      {on && !ready && (
        <span className="st-chime-hint">Tap anywhere to enable</span>
      )}
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";

// The date and a running clock, in the clinic's own timezone — not the
// device's. A phone carried in from home, or one that never had its
// timezone corrected after a trip, would otherwise print a time that
// disagrees with the wall clock on the wall behind it.
//
// SERVER-RENDERED FIRST, TICKING AFTER. The initial render uses the
// server's clock so there is no blank flash while JavaScript loads;
// useEffect then takes over so the minute actually advances instead of
// freezing at whatever it was on page load.

export default function StaffClock({ timezone }: { timezone: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Deferred rather than called synchronously in the effect body — a
    // direct setState here is a cascading render the linter is right to
    // flag, and a tick landing one frame late is invisible on a clock.
    const id = window.setInterval(() => setNow(new Date()), 1000);
    const first = window.setTimeout(() => setNow(new Date()), 0);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(first);
    };
  }, []);

  const at = now ?? new Date();
  const date = format(at, timezone, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const time = format(at, timezone, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <span className="st-clock" suppressHydrationWarning>
      {date} · {time}
    </span>
  );
}

function format(d: Date, timezone: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...opts }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", opts).format(d);
  }
}

// Minimal iCalendar (RFC 5545) generation — one VEVENT at a time, which
// is all this module needs. Not a library: a subscribed feed exposing a
// single due date is a handful of lines, and a dependency here would be
// more surface than the format itself.

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** YYYY-MM-DD -> YYYYMMDD, for an all-day (VALUE=DATE) field. */
function dateOnly(iso: string): string {
  return iso.replaceAll("-", "");
}

/** One day after a YYYY-MM-DD date, YYYYMMDD — all-day events in
 *  iCalendar use an EXCLUSIVE end, so a one-day event's DTEND is the
 *  next calendar day, not the same one. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

export interface IcsEvent {
  /** Stable across regenerations — see the header of
   *  staff-obligation-calendar.sql for why this is built from the
   *  obligation's KEY rather than a row id. */
  uid: string;
  title: string;
  description?: string | null;
  /** YYYY-MM-DD. Obligations are due dates, not appointments with a
   *  time of day, so every event here is all-day. */
  dueOn: string;
}

/** A whole calendar, with zero or one events. Zero is a valid,
 *  deliberately boring response — an obligation that has been retired
 *  or fully completed with no next occurrence yet is not an error, it
 *  is a feed with nothing due on it right now. */
export function buildCalendar(calName: string, events: IcsEvent[]): string {
  const now = stamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//medicin.io//Obligations//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calName)}`,
    // A hint some clients honor for how often to re-poll; harmless where
    // ignored.
    "X-PUBLISHED-TTL:PT24H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT24H",
  ];

  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dateOnly(e.dueOn)}`,
      `DTEND;VALUE=DATE:${nextDay(e.dueOn)}`,
      `SUMMARY:${escapeText(e.title)}`
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

import { escapeHtml } from "@/lib/staff/markdown";

// A shared look for the alert/report emails, so "make it prettier"
// means editing one file rather than re-styling each send() call by
// hand. Colors are the exact hex values behind app/globals.css's
// --danger / --status-warn / --status-good tokens (not the CSS
// variables themselves — most mail clients strip <style>/:root, so an
// email has to carry literal values), which is also why this renders
// to a plain HTML string rather than importing any component.

export type EmailTone = "critical" | "warn" | "good" | "muted";

const TONE: Record<EmailTone, { bg: string; border: string; text: string }> = {
  // --danger
  critical: { bg: "#fdecea", border: "#dc2626", text: "#dc2626" },
  // --status-warn-wash / --status-warn / --gold-700 (--status-warn-text)
  warn: { bg: "#fff3d6", border: "#fab219", text: "#8a6a17" },
  // --status-good-wash / --status-good
  good: { bg: "#e7f5e8", border: "#0f7a1a", text: "#0f7a1a" },
  // No app-side equivalent — this is the one tone that's email-only,
  // for a note that isn't a finding (an audit trail, a footer aside).
  muted: { bg: "#f1f5f9", border: "#94a3b8", text: "#475569" },
};

export interface EmailListItem {
  primary: string;
  secondary?: string;
}

export interface EmailSection {
  heading: string;
  tone: EmailTone;
  items: EmailListItem[];
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * The wordmark, at the top of every automated email — "medicin." only,
 * not the full "medicin. / BINDER" lockup (see Wordmark.tsx) and not
 * "medicin.io": a full stop reads as the finished word without the
 * site having to print its own URL in its own logo, same reasoning as
 * the header's. Colors are the same --ground/--volt-ink pair the real
 * wordmark uses on a white background (Wordmark.tsx's own CSS) —
 * literal hex here because mail clients strip stylesheets. Serif with
 * plain fallbacks, since a custom web font never loads in an inbox.
 */
function brandBanner(): string {
  return `
  <div style="padding:0 2px 14px;margin-bottom:4px;border-bottom:1px solid #e2e8f0;">
    <span style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:19px;letter-spacing:-.02em;color:#0b1220;">medicin<span style="color:#0e7490;">.</span></span>
  </div>`;
}

/**
 * At the bottom of every automated email — an adapted version of the
 * standard confidentiality footer, not a copy of any real
 * organization's. Two things, deliberately not one: a reminder that
 * this product isn't built to carry patient health information (see
 * app/security/page.tsx's own "almost no data about your patients"),
 * for the one place that claim could quietly stop being true — a
 * free-text note a person typed themselves (a corrective action, an
 * evidence note, a huddle comment) — and the ordinary
 * "wrong inbox, please delete" notice every business email carries.
 *
 * NOT ASSERTING LEGAL PRIVILEGE. A real confidentiality template often
 * claims the message is "legally privileged" under a specific statute
 * — that is a claim about who is exchanging the email and why, not
 * something true by virtue of printing it, and it would be flatly
 * wrong for a routine compliance alert. This says only what is
 * actually true here: the message may be confidential, and the wrong
 * reader should not act on it.
 */
function confidentialityFooter(): string {
  return `
  <div style="margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;">
    <p style="margin:0 0 6px;font-size:11px;line-height:1.5;color:#8a99a8;">
      medicin.io is not built to store or transmit patient health information.
      If anything above was typed by someone at your organization and names a
      patient, please remove it and let us know.
    </p>
    <p style="margin:0;font-size:11px;line-height:1.5;color:#8a99a8;">
      This message may contain information intended only for the recipient
      named above. If you received it in error, reply to let the sender know
      and then delete it &mdash; please don&rsquo;t forward or copy it elsewhere.
    </p>
  </div>`;
}

/** One section: a tone-colored card with a heading and a list of items.
 *  Every string is escaped — the content passed in is staff names, log
 *  names, and free-text notes a clinic's own users typed, not markup
 *  this app wrote, so it is untrusted the same way a comment field is. */
function sectionHtml(s: EmailSection): string {
  const c = TONE[s.tone];
  // Escape FIRST, then turn a real newline into <br> — never the other
  // way round, which would leave a literal "<br>" for escapeHtml to
  // mangle into visible text. Every caller passes raw text with real
  // "\n"s (never pre-built markup), so this is the one and only place
  // either field turns into HTML.
  const toHtml = (t: string) => escapeHtml(t).replace(/\n/g, "<br>");
  const items = s.items
    .map(
      (i) => `
      <li style="margin:0 0 8px;padding:0;list-style:none;">
        <div style="font-size:14px;line-height:1.4;color:#1a2733;">${toHtml(i.primary)}</div>
        ${
          i.secondary
            ? `<div style="font-size:12px;line-height:1.4;color:#5b7085;margin-top:1px;">${toHtml(i.secondary)}</div>`
            : ""
        }
      </li>`
    )
    .join("");

  return `
    <div style="margin:0 0 14px;padding:14px 16px;background:${c.bg};border-left:3px solid ${c.border};border-radius:6px;">
      <div style="font-size:12px;font-weight:700;color:${c.text};text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;">${escapeHtml(s.heading)}</div>
      <ul style="margin:0;padding:0;">${items}</ul>
    </div>`;
}

/**
 * The whole email body: a title, an intro line, every non-empty
 * section in order, and a footer. Sections with no items are dropped
 * rather than rendered empty — a "0 out of range" box that still shows
 * up every day is exactly the kind of noise a color-coded email is
 * supposed to cut through.
 */
export function renderEmailHtml(opts: {
  title: string;
  intro: string;
  sections: EmailSection[];
  footerLines?: string[];
}): string {
  const sections = opts.sections.filter((s) => s.items.length > 0);
  const footer = (opts.footerLines ?? [])
    .map(
      (l) =>
        `<p style="margin:3px 0;font-size:11.5px;line-height:1.5;color:#8a99a8;">${escapeHtml(l)}</p>`
    )
    .join("");

  return `
<div style="max-width:560px;margin:0 auto;font-family:${FONT};color:#1a2733;">
  ${brandBanner()}
  <div style="padding:18px 2px 6px;">
    <h1 style="font-size:17px;font-weight:700;margin:0 0 6px;">${escapeHtml(opts.title)}</h1>
    ${
      opts.intro
        ? `<p style="font-size:14px;line-height:1.5;color:#48678a;margin:0 0 16px;">${escapeHtml(opts.intro)}</p>`
        : ""
    }
  </div>
  ${sections.map(sectionHtml).join("")}
  ${
    footer
      ? `<div style="margin-top:8px;padding-top:12px;border-top:1px solid #e2e8f0;">${footer}</div>`
      : ""
  }
  ${confidentialityFooter()}
</div>`;
}

export interface HuddleTaskRow {
  task: string;
  time: string;
  status: "Late" | "Due";
}

export interface HuddleNote {
  body: string;
  author: string;
}

/**
 * The morning huddle's own layout: a bordered box, a greeting, and a
 * bordered task table — the structure the owner asked for after seeing
 * a franchise-system reminder email — built from this file's own
 * brand colors (TONE.critical/warn for Late/Due, TONE.muted's bg for
 * the table header) rather than that email's teal-and-gray palette.
 * Every other automated email (alerts, digests, EOD reports) keeps
 * using renderEmailHtml() above; this is deliberately a separate
 * function so changing the huddle's look can never silently reskin
 * those.
 */
export function renderHuddleEmailHtml(opts: {
  firstName: string;
  org: string;
  agendaHeading: string;
  rows: HuddleTaskRow[];
  notes: HuddleNote[];
  quote: string;
  timezone: string;
}): string {
  const esc = escapeHtml;
  const headerColor = "#0e7490"; // --volt-ink — the brand accent's text-safe form on a white ground.
  const borderColor = "#cbd5e1";
  const headBg = TONE.muted.bg;

  const rowsHtml =
    opts.rows.length === 0
      ? `<tr><td colspan="3" style="padding:10px 12px;border:1px solid ${borderColor};font-size:13.5px;color:#48678a;">Nothing due for you right now.</td></tr>`
      : opts.rows
          .map((r) => {
            const statusColor = r.status === "Late" ? TONE.critical.text : TONE.warn.text;
            return `
            <tr>
              <td style="padding:9px 12px;border:1px solid ${borderColor};font-size:13.5px;color:#1a2733;">${esc(r.task)}</td>
              <td style="padding:9px 12px;border:1px solid ${borderColor};font-size:13.5px;color:#48678a;">${esc(r.time)}</td>
              <td style="padding:9px 12px;border:1px solid ${borderColor};font-size:13.5px;font-weight:700;color:${statusColor};">${esc(r.status)}</td>
            </tr>`;
          })
          .join("");

  const notesHtml =
    opts.notes.length === 0
      ? ""
      : `
    <p style="margin:18px 0 6px;font-size:13px;font-weight:700;color:#1a2733;">Notes from the center admin:</p>
    ${opts.notes
      .map(
        (n) =>
          `<p style="margin:0 0 8px;font-size:13.5px;line-height:1.5;color:#1a2733;">&ldquo;${esc(n.body)}&rdquo; <span style="color:#8a99a8;">— ${esc(n.author)}</span></p>`
      )
      .join("")}`;

  return `
<div style="max-width:560px;margin:0 auto;font-family:${FONT};color:#1a2733;">
  ${brandBanner()}
  <div style="border:1px solid ${borderColor};border-radius:4px;overflow:hidden;">
    <div style="padding:20px 24px 14px;border-bottom:2px solid ${headerColor};">
      <h1 style="margin:0;font-size:18px;font-weight:700;color:${headerColor};">Good morning, ${esc(opts.firstName)}</h1>
    </div>
    <div style="padding:20px 24px;">
      <p style="margin:0 0 14px;font-size:14px;line-height:1.5;">Dear ${esc(opts.firstName)},</p>
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a2733;">${esc(opts.agendaHeading)}</p>
      <table style="width:100%;border-collapse:collapse;margin:6px 0 4px;">
        <thead>
          <tr style="background:${headBg};">
            <th style="text-align:left;padding:9px 12px;border:1px solid ${borderColor};font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#475569;">Task</th>
            <th style="text-align:left;padding:9px 12px;border:1px solid ${borderColor};font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#475569;">Time</th>
            <th style="text-align:left;padding:9px 12px;border:1px solid ${borderColor};font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#475569;">Status</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${notesHtml}
      <p style="margin:18px 0 0;font-size:13px;line-height:1.6;font-style:italic;color:#5b7085;">${esc(opts.quote)}</p>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.5;">Thanks,<br>${esc(opts.org)}</p>
    </div>
    <div style="padding:12px 24px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:11.5px;color:#8a99a8;">${esc(opts.org)} · times in ${esc(opts.timezone)}</p>
    </div>
  </div>
  ${confidentialityFooter()}
</div>`;
}

/** The tone a bare alert kind reads as, for the one-card fallback
 *  below — every enqueue() call that has not been given its own html
 *  still gets a colored card rather than a wall of monospace text. */
export function toneForAlertKind(kind: string): EmailTone {
  if (kind === "excursion" || kind === "missed_task" || kind === "missed_shift") return "critical";
  if (kind === "credential_expiry") return "warn";
  return "good";
}

/**
 * Wraps a plain-text alert body (subject already sent separately) in
 * the same card language as the digest, without knowing anything about
 * its structure. This is what an excursion, a missed-task alert, or a
 * plain "logged, within range" confirmation gets automatically — see
 * sweep() in lib/staff/alerts.ts — so the whole alert family reads as
 * one product without every enqueue() call site needing its own HTML.
 */
export function wrapPlainAlertHtml(kind: string, subject: string, body: string): string {
  const tone = toneForAlertKind(kind);
  // One card, one item: sectionHtml() escapes this and turns the real
  // "\n"s already in the body into <br> — see its own comment on why
  // that order matters. A single item is all a one-off alert needs;
  // splitting into paragraphs would just be more markup for the same
  // few lines.
  return renderEmailHtml({
    title: subject,
    intro: "",
    sections: [{ heading: kind.replace("_", " "), tone, items: [{ primary: body }] }],
  });
}

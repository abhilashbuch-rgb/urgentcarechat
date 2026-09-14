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
</div>`;
}

/** The tone a bare alert kind reads as, for the one-card fallback
 *  below — every enqueue() call that has not been given its own html
 *  still gets a colored card rather than a wall of monospace text. */
export function toneForAlertKind(kind: string): EmailTone {
  if (kind === "excursion" || kind === "missed_task") return "critical";
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

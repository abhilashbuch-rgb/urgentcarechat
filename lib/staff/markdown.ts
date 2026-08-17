// A deliberately small Markdown renderer for policy document bodies.
//
// Not a general Markdown implementation and not trying to be. It covers
// exactly the subset the documents use — headings, lists, blockquotes,
// bold, inline code, paragraphs — and renders everything else as plain
// text.
//
// SAFETY: the input is escaped FIRST, then a fixed set of patterns is
// turned into markup. Nothing in the source document can introduce a tag,
// an attribute, or a URL, because by the time any pattern runs there are
// no angle brackets left to close. That ordering is the whole security
// argument, so don't reorder it: documents are written by org admins, and
// an admin who could inject script into a page every employee is required
// to read would have a very effective way to harvest sessions.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderPolicyMarkdown(source: string): string {
  const lines = escapeHtml(source).split("\n");
  const out: string[] = [];
  let listOpen = false;
  let quoteOpen = false;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };
  const closeQuote = () => {
    if (quoteOpen) {
      out.push("</blockquote>");
      quoteOpen = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushPara();
      closeList();
      closeQuote();
      continue;
    }

    // Blockquote — used by the draft banners, so it has to stand out.
    const quote = /^&gt;\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      closeList();
      if (!quoteOpen) {
        out.push('<blockquote class="st-doc-callout">');
        quoteOpen = true;
      }
      out.push(`<p>${inline(quote[1])}</p>`);
      continue;
    }
    closeQuote();

    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const level = Math.min(heading[1].length + 1, 5); // ## -> h3
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    // Both "- item" and "1. item" render as an unordered list. The
    // documents use numbering for emphasis, not for cross-references, so
    // nothing depends on the marker being preserved.
    const item = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inline(item[1])}</li>`);
      continue;
    }

    // A continuation line inside a list item, indented under it.
    if (listOpen && /^\s{2,}\S/.test(raw)) {
      const last = out.pop();
      if (last?.startsWith("<li>")) {
        out.push(last.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`));
        continue;
      }
      if (last) out.push(last);
    }

    closeList();
    para.push(line.trim());
  }

  flushPara();
  closeList();
  closeQuote();
  return out.join("\n");
}

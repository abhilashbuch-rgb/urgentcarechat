import {
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFPage,
  PDFRef,
  StandardFonts,
  rgb,
} from "pdf-lib";
import QRCode from "qrcode";
import { ROOT_URL } from "@/lib/site";
import { KIND_LABELS } from "@/lib/staff/credentials";
import type { Binder } from "@/lib/staff/accreditation";

// The accreditation binder, drawn rather than templated.
//
// WHY pdf-lib AND NOT HTML-TO-PDF. Puppeteer needs a real Chromium
// binary, which does not exist on Vercel's serverless runtime without a
// custom layer, and a report generator that only works on somebody's
// laptop is not a feature. pdf-lib is pure JavaScript with no native
// dependency, so this runs in the same place as every other route.
//
// It also means the temperature chart is drawn with real vectors instead
// of screenshotted, so it stays sharp when a surveyor zooms in on a
// printed page — which is exactly what they do with a temperature curve.
//
// REAL BOOKMARKS. pdf-lib has no outline API, so the outline dictionary
// is assembled by hand at the end (see writeOutline). A surveyor handed
// an 80-page binder with no navigation pane will page through the first
// ten and judge the rest by those.

const A4 = { w: 595.28, h: 841.89 };
const M = 46; // page margin
const INK = rgb(0.04, 0.15, 0.25);
const SOFT = rgb(0.28, 0.4, 0.54);
const FAINT = rgb(0.55, 0.64, 0.73);
const RULE = rgb(0.84, 0.89, 0.94);
const ROYAL = rgb(0.09, 0.23, 0.54);
const WARN = rgb(0.04, 0.15, 0.25);
// The three faces of the folded M, matching app/icon.svg.
// The identity: one near-black ground and one electric accent, matching
// app/globals.css --ground and --volt.
const GROUND = rgb(0.043, 0.071, 0.125);
const VOLT = rgb(0.133, 0.827, 0.933);
// Kept for the wordmark's full stop on the cover, which stays warm
// against the cool trace.
const GOLD_MID = rgb(0.851, 0.671, 0.208);

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  pageNo: number;
  /** Section title -> page ref, collected for the outline. */
  marks: { title: string; ref: PDFRef }[];
  org: string;
  generatedAt: string;
}

export async function renderBinder(b: Binder): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const name = b.facility?.name ?? b.facility?.slug ?? "Clinic";
  doc.setTitle(`${name} — accreditation binder`);
  doc.setSubject("Compliance record. Contains no patient information.");
  doc.setProducer("medicin.io");
  doc.setCreationDate(new Date(b.generatedAt));

  const ctx: Ctx = {
    doc,
    page: doc.addPage([A4.w, A4.h]),
    y: A4.h - M,
    regular,
    bold,
    mono,
    pageNo: 1,
    marks: [],
    org: name,
    generatedAt: b.generatedAt,
  };

  await coverPage(ctx, b);
  section1(ctx, b);
  section2(ctx, b);
  section3(ctx, b);
  section4(ctx, b);
  section5(ctx, b);
  section6(ctx, b);

  footerAll(ctx);
  writeOutline(ctx);

  return doc.save();
}

/* ---------------------------------------------------------------- */
/* layout primitives                                                  */
/* ---------------------------------------------------------------- */

function newPage(c: Ctx): void {
  c.page = c.doc.addPage([A4.w, A4.h]);
  c.y = A4.h - M;
  c.pageNo += 1;
}

/** Reserve vertical space, starting a page when it will not fit. Every
 *  draw call goes through this so nothing is ever half off the page. */
function need(c: Ctx, h: number): void {
  if (c.y - h < M + 26) newPage(c);
}

function text(
  c: Ctx,
  s: string,
  opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {}
): void {
  const size = opts.size ?? 9.5;
  const font = opts.font ?? c.regular;
  need(c, size + 5);
  c.page.drawText(sanitise(s), {
    x: opts.x ?? M,
    y: c.y - size,
    size,
    font,
    color: opts.color ?? INK,
  });
  c.y -= size + 5;
}

/**
 * WinAnsi cannot encode every character a clinic might type, and an
 * unencodable byte makes pdf-lib throw halfway through a document.
 * Curly quotes, dashes and degree signs are mapped; anything else
 * outside the range becomes a question mark rather than an exception.
 */
function sanitise(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/°/g, " deg ")
    .replace(/[^\x20-\x7E]/g, "?");
}

function heading(c: Ctx, title: string, sub?: string): void {
  need(c, 60);
  // Recorded before drawing, so the outline points at the page the
  // heading actually landed on rather than the one we were on before.
  c.marks.push({ title, ref: c.page.ref });
  c.y -= 12;
  c.page.drawRectangle({ x: M, y: c.y - 2, width: 34, height: 2.5, color: ROYAL });
  c.y -= 16;
  text(c, title, { size: 15, font: c.bold });
  if (sub) text(c, sub, { size: 9, color: SOFT });
  c.y -= 8;
}

function kv(c: Ctx, k: string, v: string | null | undefined): void {
  need(c, 15);
  const label = `${k}`;
  c.page.drawText(sanitise(label), {
    x: M,
    y: c.y - 9,
    size: 9,
    font: c.regular,
    color: SOFT,
  });
  c.page.drawText(sanitise(v && v.trim() ? v : "Not recorded"), {
    x: M + 160,
    y: c.y - 9,
    size: 9,
    font: v && v.trim() ? c.bold : c.regular,
    color: v && v.trim() ? INK : FAINT,
  });
  c.y -= 15;
}

interface Col<T> {
  label: string;
  width: number;
  get: (row: T) => string;
  mono?: boolean;
}

function table<T>(c: Ctx, cols: Col<T>[], rows: T[], emptyNote: string): void {
  if (rows.length === 0) {
    text(c, emptyNote, { size: 9, color: FAINT });
    c.y -= 6;
    return;
  }

  const drawHead = () => {
    need(c, 22);
    let x = M;
    for (const col of cols) {
      c.page.drawText(sanitise(col.label.toUpperCase()), {
        x,
        y: c.y - 8,
        size: 6.6,
        font: c.bold,
        color: FAINT,
      });
      x += col.width;
    }
    c.y -= 12;
    c.page.drawLine({
      start: { x: M, y: c.y },
      end: { x: A4.w - M, y: c.y },
      thickness: 0.7,
      color: RULE,
    });
    c.y -= 6;
  };

  drawHead();

  for (const row of rows) {
    const before = c.pageNo;
    need(c, 14);
    // A table continuing onto a new page needs its header again, or the
    // second page is a grid of unlabelled columns.
    if (c.pageNo !== before) drawHead();

    let x = M;
    for (const col of cols) {
      const raw = col.get(row);
      const font = col.mono ? c.mono : c.regular;
      const size = col.mono ? 7.6 : 8.2;
      c.page.drawText(sanitise(clip(raw, col.width, font, size)), {
        x,
        y: c.y - 8,
        size,
        font,
        color: INK,
      });
      x += col.width;
    }
    c.y -= 13;
  }
  c.y -= 8;
}

/** Truncate to the column, measured in the real font rather than by
 *  character count — "WWWW" and "iiii" are not the same width. */
function clip(s: string, width: number, font: PDFFont, size: number): string {
  const max = width - 6;
  if (font.widthOfTextAtSize(sanitise(s), size) <= max) return s;
  let out = s;
  while (out.length > 1 && font.widthOfTextAtSize(sanitise(out) + "...", size) > max) {
    out = out.slice(0, -1);
  }
  return out + "...";
}

function paragraph(c: Ctx, s: string, size = 9): void {
  const maxW = A4.w - M * 2;
  const words = sanitise(s).split(/\s+/);
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (c.regular.widthOfTextAtSize(next, size) > maxW) {
      text(c, line, { size, color: SOFT });
      line = w;
    } else {
      line = next;
    }
  }
  if (line) text(c, line, { size, color: SOFT });
}

/**
 * The brand mark: the pulse trace whose two peaks are the M.
 *
 * Same path as app/icon.svg on a 48-unit grid, drawn as a stroke rather
 * than embedded as a PNG so the cover of a document a surveyor may
 * print at A3 stays sharp — and so the mark cannot drift out of step
 * with the favicon without somebody editing these coordinates.
 *
 * drawSvgPath takes SVG coordinates (y running down) from the given
 * origin, so the path below is the SVG's own string unchanged.
 */
function drawMark(c: Ctx, x: number, yTop: number, size: number): void {
  const u = size / 48;

  c.page.drawRectangle({
    x,
    y: yTop - size,
    width: size,
    height: size,
    color: GROUND,
  });

  c.page.drawSvgPath("M6 27 H12 L18 13 L24 31 L30 13 L36 27 H42", {
    x,
    y: yTop,
    scale: u,
    borderColor: VOLT,
    borderWidth: 4.4 * u,
    borderLineCap: 1, // round
  });
}

/**
 * The trace, run long across the foot of the cover.
 *
 * The same shape as the mark and the same shape the homepage stands on,
 * so the binder reads as part of the product rather than as a report it
 * happens to emit.
 */
function drawTraceRule(c: Ctx, y: number): void {
  const w = A4.w - M * 2;
  const scale = w / 240;
  c.page.drawSvgPath(
    "M0 14 H26 L38 4 L50 21 L62 4 L74 14 H132 L144 4 L156 21 L168 4 L180 14 H240",
    {
      x: M,
      y: y + 24 * scale,
      scale,
      borderColor: VOLT,
      borderWidth: 1.1,
      borderLineCap: 1,
    }
  );
}

/* ---------------------------------------------------------------- */
/* pages                                                              */
/* ---------------------------------------------------------------- */

async function coverPage(c: Ctx, b: Binder): Promise<void> {
  const name = b.facility?.name ?? b.facility?.slug ?? "Clinic";
  c.y = A4.h - 150;

  drawMark(c, M, c.y, 44);
  c.y -= 30;
  text(c, "medicin", { size: 20, font: c.bold, x: M + 58 });
  // The gold full stop, drawn separately so it can carry its own colour
  // — pdf-lib has no rich text, so a two-tone wordmark is two draws.
  c.page.drawText(".", {
    x: M + 58 + c.bold.widthOfTextAtSize("medicin", 20),
    y: c.y + 5,
    size: 20,
    font: c.bold,
    color: VOLT,
  });
  c.y -= 48;

  text(c, name, { size: 26, font: c.bold });
  text(c, "Accreditation binder", { size: 15, color: SOFT });
  c.y -= 18;

  const gen = new Date(b.generatedAt);
  kv(c, "Generated", gen.toISOString().replace("T", " ").slice(0, 19) + " UTC");
  kv(c, "Reporting window", `${b.windowDays} days`);
  kv(c, "Legal entity", b.facility?.legal_entity);
  kv(c, "Site identifier", b.facility?.site_id);

  c.y -= 20;
  paragraph(
    c,
    "This document is generated from live records at the moment of export. It contains equipment readings, staff credential expiry dates, and regulatory deadlines. It contains no patient information, and no licence, ARRT or DEA registration numbers — this system does not store them."
  );

  // The QR verifies THIS export rather than linking to a marketing page:
  // a surveyor holding a printout can confirm it came from the system
  // and has not been retyped.
  try {
    const verifyUrl = `${ROOT_URL}/verify?cert=${encodeURIComponent(
      `${b.facility?.slug ?? "org"}-${gen.getTime()}`
    )}`;
    const png = await QRCode.toBuffer(verifyUrl, { margin: 0, width: 220 });
    const img = await c.doc.embedPng(png);
    c.page.drawImage(img, { x: A4.w - M - 92, y: M + 40, width: 92, height: 92 });
    c.page.drawText("Verify this export", {
      x: A4.w - M - 92,
      y: M + 26,
      size: 7,
      font: c.regular,
      color: FAINT,
    });
  } catch {
    // A QR failure must not cost the whole binder.
  }

  drawTraceRule(c, M + 26);

  newPage(c);
}

function section1(c: Ctx, b: Binder): void {
  heading(c, "1. Facility profile", "Identity, registrations and clinical oversight");
  const f = b.facility;
  kv(c, "Facility", f?.name);
  kv(c, "Legal entity", f?.legal_entity);
  kv(c, "Site identifier", f?.site_id);
  kv(c, "Address", [f?.address_line1, f?.city, f?.state, f?.postal_code].filter(Boolean).join(", "));
  kv(c, "Telephone", f?.phone);
  kv(c, "CLIA certificate", f?.clia_number);
  kv(c, "Radiation registration", f?.pa_dep_number);
  kv(c, "NPI", f?.npi);
  kv(c, "Medical director", f?.medical_director_name);
  kv(c, "Local timezone", f?.timezone);

  c.y -= 10;
  paragraph(
    c,
    "Fields marked Not recorded are blank in the system. They are shown rather than omitted so that a gap is visible to the reader instead of being invisible."
  );
}

function section2(c: Ctx, b: Binder): void {
  heading(
    c,
    "2. Staff currency matrix",
    "Expiry dates only. No licence, ARRT or DEA numbers are held by this system."
  );
  const expired = b.currency.filter(
    (r) => r.status === "expired" || r.status === "critical"
  ).length;
  if (expired > 0) {
    text(c, `${expired} credential${expired === 1 ? "" : "s"} expired or critical.`, {
      size: 9.5,
      font: c.bold,
      color: WARN,
    });
    c.y -= 4;
  }

  table<(typeof b.currency)[number]>(
    c,
    [
      { label: "Staff member", width: 150, get: (r) => r.legal_name ?? "-" },
      { label: "Job", width: 100, get: (r) => (r.job_role ?? "-").replace(/_/g, " ") },
      { label: "Credential", width: 130, get: (r) => KIND_LABELS[r.kind] ?? r.kind },
      { label: "Expires", width: 80, get: (r) => r.expires_on ?? "No date", mono: true },
      { label: "Status", width: 60, get: (r) => r.status },
    ],
    b.currency,
    "No credentials are recorded for this clinic."
  );
}

function section3(c: Ctx, b: Binder): void {
  heading(
    c,
    "3. Refrigeration temperature record",
    `Continuous readings for the last ${b.windowDays} days, with corrective actions`
  );

  drawTempChart(c, b);

  const excursions = b.temps.filter((t) => t.out_of_range);
  if (excursions.length > 0) {
    text(c, `${excursions.length} excursion${excursions.length === 1 ? "" : "s"} in the window`, {
      size: 10,
      font: c.bold,
    });
    c.y -= 4;
    table<(typeof excursions)[number]>(
      c,
      [
        { label: "Date", width: 70, get: (r) => r.day, mono: true },
        { label: "Reading", width: 55, get: (r) => (r.current_f != null ? `${r.current_f} F` : "-"), mono: true },
        { label: "By", width: 110, get: (r) => r.submitted_by ?? "-" },
        { label: "Corrective action", width: 285, get: (r) => r.corrective_action ?? "-" },
      ],
      excursions,
      ""
    );
  }

  text(c, "All readings", { size: 10, font: c.bold });
  c.y -= 4;
  table<(typeof b.temps)[number]>(
    c,
    [
      { label: "Date", width: 70, get: (r) => r.day, mono: true },
      { label: "Unit", width: 110, get: (r) => r.unit ?? "-" },
      { label: "Current", width: 55, get: (r) => (r.current_f != null ? `${r.current_f}` : "-"), mono: true },
      { label: "Min", width: 45, get: (r) => (r.min_f != null ? `${r.min_f}` : "-"), mono: true },
      { label: "Max", width: 45, get: (r) => (r.max_f != null ? `${r.max_f}` : "-"), mono: true },
      { label: "In range", width: 55, get: (r) => (r.out_of_range ? "NO" : "yes") },
      { label: "By", width: 120, get: (r) => r.submitted_by ?? "-" },
    ],
    b.temps,
    "No temperature readings in this window."
  );
}

/**
 * The temperature curve, drawn as vectors.
 *
 * The 36-46F acceptable band is a filled rectangle behind the line, so a
 * surveyor sees at a glance whether the trace ever left it — which is
 * the only question they are asking of this chart.
 */
function drawTempChart(c: Ctx, b: Binder): void {
  const pts = b.temps.filter((t) => t.current_f != null);
  if (pts.length < 2) {
    text(c, "Not enough readings in this window to plot a curve.", {
      size: 9,
      color: FAINT,
    });
    c.y -= 6;
    return;
  }

  const H = 150;
  need(c, H + 30);
  const w = A4.w - M * 2;
  const top = c.y;
  const bottom = top - H;

  // A fixed 30-52F scale rather than one fitted to the data. An
  // auto-scaled axis makes a 49-degree excursion look identical to a
  // 38-degree normal day, because both fill the plot.
  const LO = 30;
  const HI = 52;
  const yFor = (f: number) => bottom + ((f - LO) / (HI - LO)) * H;
  const xFor = (i: number) => M + (i / (pts.length - 1)) * w;

  // Acceptable band.
  c.page.drawRectangle({
    x: M,
    y: yFor(36),
    width: w,
    height: yFor(46) - yFor(36),
    color: rgb(0.87, 0.93, 0.98),
  });

  for (const f of [36, 46]) {
    c.page.drawLine({
      start: { x: M, y: yFor(f) },
      end: { x: M + w, y: yFor(f) },
      thickness: 0.6,
      color: rgb(0.55, 0.7, 0.86),
    });
    c.page.drawText(`${f} F`, {
      x: M + w + 3,
      y: yFor(f) - 3,
      size: 6.5,
      font: c.regular,
      color: FAINT,
    });
  }

  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const d = pts[i];
    c.page.drawLine({
      start: { x: xFor(i - 1), y: yFor(Number(a.current_f)) },
      end: { x: xFor(i), y: yFor(Number(d.current_f)) },
      thickness: 1.1,
      color: ROYAL,
    });
  }

  // Excursions marked individually — the point of the chart.
  for (let i = 0; i < pts.length; i += 1) {
    if (!pts[i].out_of_range) continue;
    c.page.drawCircle({
      x: xFor(i),
      y: yFor(Number(pts[i].current_f)),
      size: 2.6,
      color: rgb(0.04, 0.15, 0.25),
    });
  }

  c.page.drawLine({
    start: { x: M, y: bottom },
    end: { x: M + w, y: bottom },
    thickness: 0.7,
    color: RULE,
  });
  c.page.drawText(sanitise(`${pts[0].day}  to  ${pts[pts.length - 1].day}`), {
    x: M,
    y: bottom - 11,
    size: 7,
    font: c.regular,
    color: FAINT,
  });

  c.y = bottom - 24;
}

function section4(c: Ctx, b: Binder): void {
  heading(c, "4. Crash cart and AED verification", "Daily readiness checks");
  table<(typeof b.crashCart)[number]>(
    c,
    [
      { label: "Date", width: 70, get: (r) => r.day, mono: true },
      { label: "Slot", width: 45, get: (r) => (r.slot || "-").toUpperCase() },
      { label: "Seal", width: 80, get: (r) => String(r.answers?.["seal_number"] ?? "-"), mono: true },
      { label: "AED", width: 70, get: (r) => String(r.answers?.["aed_status"] ?? "-") },
      { label: "Flagged", width: 55, get: (r) => (r.out_of_range ? "YES" : "no") },
      { label: "By", width: 150, get: (r) => r.submitted_by ?? "-" },
    ],
    b.crashCart,
    "No crash cart checks recorded in this window."
  );
}

function section5(c: Ctx, b: Binder): void {
  heading(
    c,
    "5. CLIA-waived point-of-care quality control",
    "Control runs and their outcomes"
  );
  table<(typeof b.poct)[number]>(
    c,
    [
      { label: "Date", width: 70, get: (r) => r.day, mono: true },
      { label: "Slot", width: 45, get: (r) => (r.slot || "-").toUpperCase() },
      { label: "Flagged", width: 55, get: (r) => (r.out_of_range ? "YES" : "no") },
      { label: "Corrective action", width: 230, get: (r) => r.corrective_action ?? "-" },
      { label: "By", width: 120, get: (r) => r.submitted_by ?? "-" },
    ],
    b.poct,
    "No point-of-care QC recorded in this window."
  );
}

function section6(c: Ctx, b: Binder): void {
  heading(c, "6. Obligations and signed policies", "Deadlines, and who signed what");

  text(c, "Regulatory obligations", { size: 10, font: c.bold });
  c.y -= 4;
  table<(typeof b.obligations)[number]>(
    c,
    [
      { label: "Obligation", width: 210, get: (r) => r.title },
      { label: "Due", width: 70, get: (r) => r.due_on, mono: true },
      { label: "Status", width: 70, get: (r) => r.status.replace(/_/g, " ") },
      { label: "Owner", width: 120, get: (r) => r.owner_name ?? "Unassigned" },
    ],
    b.obligations,
    "No obligations recorded."
  );

  text(c, "Policy attestations", { size: 10, font: c.bold });
  c.y -= 4;
  table<(typeof b.attestations)[number]>(
    c,
    [
      { label: "Staff member", width: 150, get: (r) => r.legal_name ?? "-" },
      { label: "Document", width: 230, get: (r) => r.doc_title },
      { label: "Version", width: 50, get: (r) => `v${r.doc_version}`, mono: true },
      { label: "Signed", width: 90, get: (r) => r.signed_at.slice(0, 16).replace("T", " "), mono: true },
    ],
    b.attestations,
    "No signed policies recorded."
  );
}

/* ---------------------------------------------------------------- */
/* finishing                                                          */
/* ---------------------------------------------------------------- */

/** Page numbers and provenance on every page, added at the end when the
 *  total is finally known. */
function footerAll(c: Ctx): void {
  const pages = c.doc.getPages();
  const stamp = `${c.org} — generated ${c.generatedAt.slice(0, 19).replace("T", " ")} UTC`;
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: M, y: M + 14 },
      end: { x: A4.w - M, y: M + 14 },
      thickness: 0.6,
      color: RULE,
    });
    p.drawText(sanitise(stamp), {
      x: M,
      y: M + 4,
      size: 6.8,
      font: c.regular,
      color: FAINT,
    });
    const label = `${i + 1} / ${pages.length}`;
    p.drawText(label, {
      x: A4.w - M - c.regular.widthOfTextAtSize(label, 6.8),
      y: M + 4,
      size: 6.8,
      font: c.regular,
      color: FAINT,
    });
  });
}

/**
 * The outline (bookmark) tree.
 *
 * pdf-lib exposes no outline API, so this writes the dictionaries
 * directly: one Outlines root, one item per section, chained by
 * Prev/Next with First/Last on the root. Without it the reader's
 * navigation pane is empty, and an 80-page binder with no navigation is
 * one a surveyor pages through for ten pages and then puts down.
 */
function writeOutline(c: Ctx): void {
  if (c.marks.length === 0) return;
  const ctxLow = c.doc.context;

  const rootRef = ctxLow.nextRef();
  const itemRefs = c.marks.map(() => ctxLow.nextRef());

  c.marks.forEach((mark, i) => {
    const dict = ctxLow.obj({
      // PDFHexString, NOT ctxLow.obj(string). context.obj() turns a bare
      // JS string into a PDF *name*, so the bookmarks came out as
      // "/1.#20Facility#20profile" — a name with escaped spaces, which
      // readers render mangled or not at all. An outline title is a PDF
      // string. Caught by loading the finished file back and reading the
      // outline, which is the only way this is visible.
      Title: PDFHexString.fromText(sanitise(mark.title)),
      Parent: rootRef,
      Dest: ctxLow.obj([mark.ref, ctxLow.obj("Fit")]),
      ...(i > 0 ? { Prev: itemRefs[i - 1] } : {}),
      ...(i < itemRefs.length - 1 ? { Next: itemRefs[i + 1] } : {}),
    });
    ctxLow.assign(itemRefs[i], dict);
  });

  ctxLow.assign(
    rootRef,
    ctxLow.obj({
      Type: "Outlines",
      First: itemRefs[0],
      Last: itemRefs[itemRefs.length - 1],
      Count: itemRefs.length,
    })
  );

  c.doc.catalog.set(ctxLow.obj("Outlines"), rootRef);
  // PageMode UseOutlines makes the reader open with the pane showing,
  // rather than hiding navigation the document does have.
  c.doc.catalog.set(ctxLow.obj("PageMode"), ctxLow.obj("UseOutlines"));
}

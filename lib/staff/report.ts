import { PDFDocument, StandardFonts } from "pdf-lib";
import type { StaffSql } from "@/lib/staff/db";
import {
  A4,
  M,
  type Col,
  type Ctx,
  footerAll,
  heading,
  SOFT,
  kv,
  table,
  text,
  writeOutline,
} from "@/lib/staff/binder-pdf";

// The scheduled log report: one period, every filing, everything needed
// to judge it.
//
// BUILT ON THE BINDER'S LAYOUT PRIMITIVES rather than its own copy of
// them. Two PDF renderers in one codebase drift, and the one that drifts
// is always the one nobody is looking at — see the bookmark bug in
// staff-log-photos' commit, which was invisible until somebody loaded the
// finished file back. Sharing `table`, `heading` and `need` means a fix
// to pagination fixes both documents.
//
// RENDERED ON DEMAND, NEVER STORED. See the header of
// supabase/staff-reports.sql. The consequence worth restating here: this
// function is called when somebody OPENS the link, possibly weeks later,
// so it must render the period it is given rather than anything relative
// to today.

export type Cadence = "daily" | "weekly" | "monthly";

export interface ReportRow {
  due_date: string;
  form_name: string;
  category: string | null;
  slot: string | null;
  submitted_at: string | null;
  filed_by: string | null;
  has_out_of_range: boolean;
  out_of_range_fields: string[] | null;
  corrective_action: string | null;
  location_status: string;
  distance_m: number | null;
}

export interface ReportData {
  org: string;
  orgName: string;
  cadence: Cadence;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  rows: ReportRow[];
  /** Templates that were due in the window and never filed. */
  missed: { due_date: string; form_name: string; slot: string | null }[];
  generatedAt: string;
}

export interface ReportTotals {
  filed: number;
  missed: number;
  outOfRange: number;
  offSite: number;
  people: number;
}

/** The four numbers that go in the email body, so a clean period needs
 *  no click. Derived from the same rows the PDF renders, never counted
 *  separately — two counts of one thing eventually disagree. */
export function totals(d: ReportData): ReportTotals {
  return {
    filed: d.rows.length,
    missed: d.missed.length,
    outOfRange: d.rows.filter((r) => r.has_out_of_range).length,
    offSite: d.rows.filter((r) => r.location_status === "off_site").length,
    people: new Set(d.rows.map((r) => r.filed_by).filter(Boolean)).size,
  };
}

export async function gatherReport(
  sql: StaffSql,
  org: string,
  cadence: Cadence,
  periodStart: string,
  periodEnd: string
): Promise<ReportData> {
  const [orgRow] = await sql<{ name: string; timezone: string }[]>`
    select name, timezone from staff.orgs where slug = ${org}
  `;

  const rows = await sql<ReportRow[]>`
    select due_date::text as due_date, form_name, category, slot,
           submitted_at::text as submitted_at, filed_by,
           has_out_of_range, out_of_range_fields, corrective_action,
           location_status, distance_m
      from staff.report_log_rows
     where due_date between ${periodStart}::date and ${periodEnd}::date
     order by due_date, form_name, slot
  `;

  // What was DUE and never arrived. A report that lists only what was
  // filed is a report in which a clinic that logged nothing all week
  // looks identical to one that had nothing due — which is the single
  // most misleading thing a compliance summary can do.
  const missed = await sql<
    { due_date: string; form_name: string; slot: string | null }[]
  >`
    select i.due_date::text as due_date, t.name as form_name, i.slot
      from staff.form_instances i
      join staff.form_templates t on t.id = i.template_id
     where i.org_slug = ${org}
       and i.due_date between ${periodStart}::date and ${periodEnd}::date
       and not exists (
         select 1 from staff.form_responses r where r.instance_id = i.id
       )
     order by i.due_date, t.sort_order
  `;

  return {
    org,
    orgName: orgRow?.name ?? org,
    cadence,
    periodStart,
    periodEnd,
    timezone: orgRow?.timezone ?? "America/New_York",
    rows,
    missed,
    generatedAt: new Date().toISOString(),
  };
}

const CADENCE_LABEL: Record<Cadence, string> = {
  daily: "Daily log report",
  weekly: "Weekly log report",
  monthly: "Monthly log report",
};

/** Time of day in the clinic's own zone. An owner reading "07:12" wants
 *  the clinic's 07:12, not UTC's. */
function localTime(iso: string | null, tz: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

function place(r: ReportRow): string {
  switch (r.location_status) {
    case "on_site":
      return r.distance_m === null ? "On site" : `On site (${r.distance_m} m)`;
    case "off_site":
      return r.distance_m === null ? "OFF SITE" : `OFF SITE (${r.distance_m} m)`;
    case "denied":
      return "Location declined";
    case "unavailable":
      return "No location";
    default:
      return "—";
  }
}

export async function renderReport(d: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  doc.setTitle(`${d.orgName} — ${CADENCE_LABEL[d.cadence].toLowerCase()}`);
  doc.setSubject("Compliance record. Contains no patient information.");
  doc.setProducer("medicin.io");
  doc.setCreationDate(new Date(d.generatedAt));

  const c: Ctx = {
    doc,
    page: doc.addPage([A4.w, A4.h]),
    y: A4.h - M,
    regular,
    bold,
    mono,
    pageNo: 1,
    marks: [],
    org: d.orgName,
    generatedAt: d.generatedAt,
  };

  const t = totals(d);
  const period =
    d.periodStart === d.periodEnd
      ? d.periodStart
      : `${d.periodStart} to ${d.periodEnd}`;

  heading(c, CADENCE_LABEL[d.cadence], `${d.orgName} · ${period}`);

  kv(c, "Logs filed", String(t.filed));
  kv(c, "Due and not filed", String(t.missed));
  kv(c, "Out of range", String(t.outOfRange));
  kv(c, "Filed away from the clinic", String(t.offSite));
  kv(c, "Staff who filed", String(t.people));
  kv(c, "Times shown in", d.timezone);
  c.y -= 8;

  // THE EXCEPTIONS FIRST, because that is what the report is opened for.
  // A reader scanning a month of clean logs for the one warm fridge is a
  // reader who will stop opening these.
  const flagged = d.rows.filter((r) => r.has_out_of_range);
  heading(c, "Out of range", "Every reading outside its limit, with what was done about it.");
  const flagCols: Col<ReportRow>[] = [
    { label: "Date", width: 62, get: (r) => r.due_date },
    { label: "Log", width: 118, get: (r) => r.form_name },
    { label: "By", width: 92, get: (r) => r.filed_by ?? "—" },
    { label: "Fields", width: 92, get: (r) => (r.out_of_range_fields ?? []).join(", ") },
    { label: "Corrective action", width: 139, get: (r) => r.corrective_action ?? "—" },
  ];
  table(c, flagCols, flagged, "Nothing out of range in this period.");

  if (t.missed > 0) {
    heading(c, "Due and not filed", "A gap in the record is the finding, not the absence of a number.");
    table(
      c,
      [
        { label: "Date", width: 90, get: (m: (typeof d.missed)[number]) => m.due_date },
        { label: "Log", width: 240, get: (m: (typeof d.missed)[number]) => m.form_name },
        { label: "Shift", width: 90, get: (m: (typeof d.missed)[number]) => (m.slot ? m.slot.toUpperCase() : "—") },
      ],
      d.missed,
      ""
    );
  }

  const offSite = d.rows.filter(
    (r) => r.location_status === "off_site" || r.location_status === "denied"
  );
  if (offSite.length > 0) {
    heading(
      c,
      "Filed away from the clinic",
      "Location is a stamp on the record, not a guarantee — see the note on the last page."
    );
    table(
      c,
      [
        { label: "Date", width: 62, get: (r: ReportRow) => r.due_date },
        { label: "Log", width: 132, get: (r: ReportRow) => r.form_name },
        { label: "By", width: 104, get: (r: ReportRow) => r.filed_by ?? "—" },
        { label: "Where", width: 205, get: (r: ReportRow) => place(r) },
      ],
      offSite,
      ""
    );
  }

  // Then everything, in order, so the report is a complete record rather
  // than a summary somebody has to trust.
  heading(c, "Every log filed", "In date order, with the minute each was signed.");
  const allCols: Col<ReportRow>[] = [
    { label: "Date", width: 58, get: (r) => r.due_date },
    { label: "Time", width: 38, get: (r) => localTime(r.submitted_at, d.timezone) },
    { label: "Log", width: 122, get: (r) => r.form_name },
    { label: "Shift", width: 34, get: (r) => (r.slot ? r.slot.toUpperCase() : "—") },
    { label: "Filed by", width: 100, get: (r) => r.filed_by ?? "—" },
    { label: "Where", width: 99, get: (r) => place(r) },
  ];
  table(c, allCols, d.rows, "No logs were filed in this period.");

  heading(c, "About this report");
  text(
    c,
    "Generated from the record at the moment this link was opened, not from a stored copy — so an amended entry shows as amended. Every signature in this system is insert-only: entries cannot be edited or deleted after filing.",
    { size: 9, color: SOFT }
  );
  c.y -= 6;
  text(
    c,
    "Location is a stamp, not a control. Browser geolocation can be falsified and is unreliable indoors, so an on-site line is evidence of what the device reported, not proof of where somebody stood. An off-site line carries the reason the person gave.",
    { size: 9, color: SOFT }
  );
  c.y -= 6;
  text(c, "This report contains no patient information.", {
    size: 9,
    color: SOFT,

  });

  footerAll(c);
  writeOutline(c);
  return doc.save();
}

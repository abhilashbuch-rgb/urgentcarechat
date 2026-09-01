import { PDFDocument, StandardFonts } from "pdf-lib";
import type { StaffSql } from "@/lib/staff/db";
import { send, isMailConfigured } from "@/lib/mail";
import { A4, M, type Ctx, heading, kv, text, footerAll } from "@/lib/staff/binder-pdf";

// Tonight's patient count, handed to billing — see
// supabase/staff-billing-stats.sql for why this is deliberately not a
// compliance log and not the same recipient list as the EOD report.

export interface BillingStatsEntry {
  stats_date: string;
  patient_count: number;
  notes: string | null;
  submitted_by_name: string | null;
  submitted_at: string;
}

/** Today's entry, if the front desk has already filed one — so the page
 *  shows what's there rather than a blank form somebody re-fills by
 *  accident and doubles the count. */
export async function todaysBillingStats(
  sql: StaffSql,
  org: string
): Promise<BillingStatsEntry | null> {
  const rows = await sql<BillingStatsEntry[]>`
    select b.stats_date::text as stats_date, b.patient_count, b.notes,
           u.legal_name as submitted_by_name, b.submitted_at::text as submitted_at
      from staff.billing_stats b
      left join staff.users u on u.id = b.submitted_by
     where b.org_slug = ${org} and b.stats_date = current_date
  `;
  return rows[0] ?? null;
}

/** Saves tonight's count, correcting it in place if this is a resubmit —
 *  see the unique (org_slug, stats_date) on staff.billing_stats. */
export async function saveBillingStats(
  sql: StaffSql,
  org: string,
  userId: string,
  patientCount: number,
  notes: string | null
): Promise<void> {
  await sql`
    insert into staff.billing_stats (org_slug, stats_date, patient_count, notes, submitted_by)
    values (${org}, current_date, ${patientCount}, ${notes}, ${userId})
    on conflict (org_slug, stats_date) do update
      set patient_count = excluded.patient_count,
          notes = excluded.notes,
          submitted_by = excluded.submitted_by,
          submitted_at = now()
  `;
}

export async function billingContactEmail(
  sql: StaffSql,
  org: string
): Promise<string | null> {
  const rows = await sql<{ billing_contact_email: string | null }[]>`
    select billing_contact_email from staff.orgs where slug = ${org}
  `;
  return rows[0]?.billing_contact_email ?? null;
}

/** The narrow PDF a biller actually needs — a count and a note, not the
 *  full EOD report an owner gets (which names people, times and
 *  corrective actions a billing contact has no reason to see). */
async function renderBillingStatsPdf(
  orgName: string,
  entry: BillingStatsEntry
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const generatedAt = new Date().toISOString();

  doc.setTitle(`${orgName} — patient count, ${entry.stats_date}`);
  doc.setSubject("Nightly patient count for billing. No patient information.");
  doc.setProducer("medicin.io");
  doc.setCreationDate(new Date(generatedAt));

  const c: Ctx = {
    doc,
    page: doc.addPage([A4.w, A4.h]),
    y: A4.h - M,
    regular,
    bold,
    mono,
    pageNo: 1,
    marks: [],
    org: orgName,
    generatedAt,
  };

  heading(c, "Patient count", `${orgName} · ${entry.stats_date}`);
  kv(c, "Patients seen", String(entry.patient_count));
  kv(c, "Filed by", entry.submitted_by_name ?? "—");
  c.y -= 8;

  if (entry.notes && entry.notes.trim()) {
    heading(c, "Notes");
    text(c, entry.notes, { size: 10 });
  }

  footerAll(c);
  return doc.save();
}

export interface BillingStatsSendOutcome {
  ok: boolean;
  /** No email attempted — nothing is configured to send to. Not a
   *  failure: the count is still saved, this is just the biller step
   *  being optional. */
  skipped?: "no_recipient" | "mail_not_configured";
  error?: string;
}

/** Renders and sends tonight's count if, and only if, an owner has set
 *  a billing contact. Called synchronously from the submit route — see
 *  its header for why this is a direct send rather than a queued one. */
export async function sendBillingStats(
  sql: StaffSql,
  org: string,
  orgName: string,
  entry: BillingStatsEntry
): Promise<BillingStatsSendOutcome> {
  const to = await billingContactEmail(sql, org);
  if (!to) return { ok: true, skipped: "no_recipient" };
  if (!isMailConfigured()) return { ok: true, skipped: "mail_not_configured" };

  try {
    const pdf = await renderBillingStatsPdf(orgName, entry);
    await send({
      to,
      subject: `${orgName} — patient count, ${entry.stats_date}`,
      text:
        `${orgName} — ${entry.stats_date}\n\n` +
        `Patients seen: ${entry.patient_count}\n` +
        (entry.notes && entry.notes.trim() ? `\nNotes:\n${entry.notes}\n` : "") +
        `\nFiled by ${entry.submitted_by_name ?? "the front desk"}. ` +
        `The same numbers are attached as a PDF.`,
      attachments: [
        {
          filename: `${org}-patient-count-${entry.stats_date}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

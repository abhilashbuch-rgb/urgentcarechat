import type { StaffSql } from "@/lib/staff/db";

// Search over the clinic's own protocols and the public guidance loaded
// alongside them.
//
// THIS RETURNS PASSAGES SOMEBODY WROTE, WITH A CITATION. It does not
// generate a regimen, infer a contraindication, or compose a dose.
// Software that analyses a patient's specifics and recommends treatment
// is clinical decision support with a regulatory and malpractice
// conversation attached; software that finds you the right page of your
// own protocol is a search box. There is no function here that returns a
// generated answer, because the way that boundary erodes is by somebody
// adding one.

export interface ProtocolHit {
  protocol_id: string;
  section_id: string;
  title: string;
  source: string;
  protocol_code: string | null;
  source_date: string | null;
  reviewed_on: string | null;
  heading: string | null;
  body: string;
  section_no: number;
  rank: number;
}

export async function searchProtocols(
  sql: StaffSql,
  q: string,
  jobRole: string | null,
  limit = 12
): Promise<ProtocolHit[]> {
  return sql<ProtocolHit[]>`
    select protocol_id, section_id, title, source, protocol_code,
           source_date::text as source_date,
           reviewed_on::text as reviewed_on,
           heading, body, section_no, rank
      from staff.search_protocols(
        ${q}, ${jobRole}::staff.job_role, ${limit}
      )
  `;
}

/** What people looked for, so a clinic can see what it has not written
 *  down. Insert-only; the query text is scrubbed and capped before it
 *  gets here. */
export async function logQuery(
  sql: StaffSql,
  args: { org: string; userId: string; q: string; hits: number }
): Promise<void> {
  // The stored text is whatever survives staff.scrub_to_corpus — only
  // words that already appear in a published protocol here. See the
  // header of supabase/staff-protocols.sql: scrubQuery() below strips
  // dates and identifiers, but nothing regular can recognise a person's
  // name, so the log keeps the clinical vocabulary and a count of what
  // it dropped rather than the sentence.
  await sql`
    insert into staff.protocol_queries (org_slug, asked_by, q, hits, unknown_terms)
    select ${args.org}, ${args.userId}, c.kept, ${args.hits}, c.unknown_count
      from staff.scrub_to_corpus(${args.q}) c
  `;
}

/**
 * Strip anything that looks like it identifies a person, then truncate.
 *
 * A free-text clinical search box is precisely where somebody eventually
 * types "Maria Gonzalez 04/12/1978 laceration". This product's whole
 * position is that it holds no PHI and therefore needs no BAA, and that
 * is true only for as long as nothing writes patient identifiers to a
 * table. The query log is the one place in this feature that persists
 * what a person typed, so the scrubbing happens before the insert and
 * not in a dashboard afterwards.
 *
 * It is deliberately blunt: any run of four or more digits, anything
 * shaped like a date, and anything shaped like an MRN or a phone number
 * becomes a marker. Losing "Centor 4" from an analytics row costs
 * nothing; keeping a date of birth costs the product its central claim.
 *
 * THIS IS THE FIRST OF TWO PASSES AND ON ITS OWN IT IS NOT ENOUGH.
 * Tested with "Maria Gonzalez 04/12/1978 MRN4471902 laceration": the
 * date and the MRN were replaced and the name went through untouched,
 * because no regular expression distinguishes a person's name from a
 * place, a drug, or a syndrome carrying two eponyms. The second pass is
 * staff.scrub_to_corpus() in the database, which keeps only words that
 * already appear in a published protocol — see logQuery() above.
 */
export function scrubQuery(raw: string): string {
  return raw
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, "[date]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[date]")
    .replace(/\b\d{4,}\b/g, "[number]")
    .replace(/\b[A-Z]{2,}\d{3,}\b/gi, "[id]")
    .trim()
    .slice(0, 200);
}

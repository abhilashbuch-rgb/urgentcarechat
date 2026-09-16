import type { StaffSql } from "@/lib/staff/db";
import { withOrg } from "@/lib/staff/db";
import { isMailConfigured, send } from "@/lib/mail";
import { renderEmailHtml } from "@/lib/staff/email-html";
import { ROOT_URL } from "@/lib/site";

// "Reminded by email on day of" — for whoever an obligation is actually
// assigned to, not a blanket digest. Deliberately separate from the
// huddle/AM-PM digest pipeline in lib/staff/alerts.ts and
// lib/staff/huddle.ts: those already run for every real clinic today,
// and obligations were kept out of them on purpose (see the header of
// supabase/staff-obligations.sql) — a due-date deadline calendar is a
// different kind of thing from a shift task, and folding it into a
// pipeline built for the other would risk both.

export interface DueTodayObligation {
  id: string;
  title: string;
  detail: string | null;
  citation: string | null;
  owner_email: string;
  owner_name: string | null;
}

/** Obligations due exactly today, in the ORG's OWN timezone, with a
 *  real active person assigned. An obligation with nobody owning it
 *  has nobody to remind — see the "Nobody" state on
 *  app/staff/obligations/[id]/page.tsx, which is deliberate rather
 *  than defaulted away, and stays that way here: this never guesses a
 *  recipient. */
export async function dueTodayWithOwner(
  sql: StaffSql,
  org: string
): Promise<DueTodayObligation[]> {
  return sql<DueTodayObligation[]>`
    select o.id, o.title, o.detail, o.citation,
           u.email as owner_email, u.legal_name as owner_name
      from staff.obligations o
      join staff.orgs org on org.slug = o.org_slug
      join staff.users u on u.id = o.owner_id and u.active
     where o.org_slug = ${org}
       and o.active and o.completed_at is null
       and o.due_on = (now() at time zone org.timezone)::date
  `;
}

export interface ReminderOutcome {
  obligationId: string;
  to: string;
  ok: boolean;
  error?: string;
}

/** Sends today's reminders for one org, one email per obligation
 *  (never bundled) — the huddle already proved that "your morning
 *  agenda" reads better as one message, but this is a single deadline
 *  with a single owner, and bundling it with whatever ELSE that person
 *  owns today would make tomorrow's version of this function decide
 *  how to group unrelated obligations, which is a problem this doesn't
 *  need to solve. */
export async function sendDueTodayReminders(org: string): Promise<ReminderOutcome[]> {
  if (!isMailConfigured()) return [];

  return withOrg(org, "platform_super_admin", async (sql) => {
    const due = await dueTodayWithOwner(sql, org);
    const outcomes: ReminderOutcome[] = [];

    for (const ob of due) {
      const url = `${ROOT_URL}/staff/obligations/${ob.id}`;
      const html = renderEmailHtml({
        title: "Due today",
        intro: `${ob.owner_name ?? "This"} is assigned to you and due today.`,
        sections: [
          {
            heading: "Due today",
            tone: "warn",
            items: [
              {
                primary: ob.title,
                secondary: [ob.detail, ob.citation].filter(Boolean).join(" — ") || undefined,
              },
            ],
          },
        ],
        footerLines: [`Open it and mark it done: ${url}`],
      });

      try {
        await send({
          to: ob.owner_email,
          subject: `Due today: ${ob.title}`,
          text: [
            `${ob.title} is due today.`,
            ob.detail ?? "",
            ob.citation ?? "",
            "",
            `Open it and mark it done: ${url}`,
          ]
            .filter(Boolean)
            .join("\n"),
          html,
        });
        outcomes.push({ obligationId: ob.id, to: ob.owner_email, ok: true });
      } catch (err) {
        outcomes.push({
          obligationId: ob.id,
          to: ob.owner_email,
          ok: false,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }
    return outcomes;
  });
}

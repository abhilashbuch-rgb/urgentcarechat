import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import {
  getObligation,
  dueLabel,
  repeatLabel,
  formatDue,
  STATUS_LABELS,
} from "@/lib/staff/obligations";
import { calendarLinksFor } from "@/lib/staff/obligation-calendar";
import {
  ALLOWED_OBLIGATION_KEY,
  forwardingAddress,
  inboundConfigured,
  recentInboundActivity,
} from "@/lib/staff/waste-pickup-inbound";
import { formatSignedAt } from "@/lib/staff/labels";
import ObligationActions from "@/app/components/staff/ObligationActions";
import CalendarLinks from "@/app/components/staff/CalendarLinks";
import WastePickupForwarding from "@/app/components/staff/WastePickupForwarding";

// One obligation, and everything about it that isn't the app's opinion:
// what it is, the rule behind it, who owns it, when it's due, and — if
// it's been done — what was actually done and by whom.
//
// The evidence note is the whole thing. "Done" on its own is a checkbox,
// and a checkbox proves that somebody clicked. What gets shown to a
// surveyor is the sentence underneath it.

export const dynamic = "force-dynamic";

export default async function ObligationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { session, org } = await requireStaff();
  const { id } = await params;

  const data = await withSession(session, async (sql) => {
    const obligation = await getObligation(sql, id);
    if (!obligation) return null;
    // Only fetched for the assignment picker, and only for the people who
    // can use it.
    const team = atLeast(session.role, "clinical_lead")
      ? await sql<{ id: string; label: string }[]>`
          select id, coalesce(legal_name, name, email) as label
            from staff.users where active order by label
        `
      : [];
    const isAdminForCalendar = atLeast(session.role, "manager");
    const calendarLinks = isAdminForCalendar ? await calendarLinksFor(sql, obligation.key) : [];
    const inboundActivity =
      isAdminForCalendar && obligation.key === ALLOWED_OBLIGATION_KEY
        ? await recentInboundActivity(sql)
        : [];
    return { obligation, team, calendarLinks, inboundActivity };
  });

  if (!data) notFound();
  const { obligation: o, team, calendarLinks, inboundActivity } = data;

  const isLead = atLeast(session.role, "clinical_lead");
  const isAdmin = atLeast(session.role, "manager");
  const canComplete = isLead || o.owner_id === session.uid;
  // Same reasoning as canComplete: whoever a pickup obligation is
  // assigned to is the one who actually reads the hauler's email, and
  // their account role is very often plain "staff".
  const canReschedule = isLead || o.owner_id === session.uid;
  const repeat = repeatLabel(o.repeat_months);

  return (
    <div className="st-page">
      <p className="st-back">
        <Link href="/staff/obligations">&larr; Obligations</Link>
      </p>

      <header className="st-page-head">
        <h1 className="st-h1">{o.title}</h1>
        <p className="st-page-sub">
          {STATUS_LABELS[o.status]}
          {o.status !== "done" && ` · ${dueLabel(o.days_out)}`}
          {o.category && ` · ${o.category}`}
        </p>
      </header>

      <section className="st-ob-facts">
        <Fact label="Due">{formatDue(o.due_on)}</Fact>
        <Fact label="Owner">
          {o.owner_name || o.owner_email ? (
            <>
              {o.owner_name ?? o.owner_email}
              {o.owner_active === false && (
                <span className="st-ob-unowned"> (deactivated)</span>
              )}
            </>
          ) : (
            <span className="st-ob-unowned">Nobody</span>
          )}
        </Fact>
        <Fact label="Repeats">{repeat ?? "One-off"}</Fact>
        <Fact label="Source">{o.source ?? "—"}</Fact>
        {o.citation && <Fact label="Rule">{o.citation}</Fact>}
      </section>

      {o.detail && <p className="st-ob-detail">{o.detail}</p>}

      {o.status === "done" && (
        <section className="st-ob-done">
          <h2 className="st-h2">What was done</h2>
          <p className="st-ob-evidence">{o.evidence_note}</p>
          <p className="st-ob-evidence-by">
            {o.completed_by_name ?? o.completed_by_email ?? "Unknown"} &middot;{" "}
            {o.completed_at ? formatSignedAt(o.completed_at) : ""}
          </p>
          {repeat && (
            <p className="st-log-hint">
              The next one is already on the register, dated from this
              one&rsquo;s due date rather than from today &mdash; so finishing
              late doesn&rsquo;t walk the schedule later every year.
            </p>
          )}
        </section>
      )}

      {o.was_reopened && (
        <section className="st-ob-history">
          <h2 className="st-h2">Earlier completions</h2>
          <p className="st-ob-blurb">
            Recorded and then reopened. Kept rather than erased &mdash; a
            register that quietly rewrites its own history is not evidence of
            anything.
          </p>
          <ul className="st-ob-history-list">
            {o.history.map((h, i) => (
              <li key={i}>
                <span className="st-ob-history-when">
                  {h.completed_at ? formatSignedAt(h.completed_at) : "—"}
                </span>
                {h.evidence_note && <p>{h.evidence_note}</p>}
                <p className="st-ob-history-reason">
                  Reopened{h.reason ? `: ${h.reason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ObligationActions
        id={o.id}
        status={o.status}
        dueOn={o.due_on}
        ownerId={o.owner_id}
        canComplete={canComplete}
        canReschedule={canReschedule}
        isLead={isLead}
        isAdmin={isAdmin}
        team={team}
      />

      {/* MANAGER AND ABOVE, AND ONLY ON THE ONE OBLIGATION THIS PIPELINE
          KNOWS ABOUT. Setting this up is exactly the kind of thing an
          administrator has to configure once and then never think
          about again — see lib/staff/waste-pickup-inbound.ts for what
          it will and won't act on. */}
      {isAdmin && o.key === ALLOWED_OBLIGATION_KEY && (
        <section className="st-record-section">
          <h2 className="st-h2">Automatic pickup-date updates</h2>
          <p className="st-page-sub" style={{ marginBottom: 12 }}>
            Forward Sharps Compliance&rsquo;s own pickup-confirmation email to
            the address below, and this due date moves itself &mdash; nobody
            has to open this page and click Move every time a pickup is
            confirmed.
          </p>
          <WastePickupForwarding
            address={forwardingAddress(org)}
            configured={inboundConfigured()}
            activity={inboundActivity}
          />
        </section>
      )}

      {/* MANAGER AND ABOVE ONLY — same tier as the surveyor link this
          borrows its shape from. A calendar link discloses this one due
          date to whoever holds the URL, so deciding who gets handed one
          is an administrative call, not a clinical one. */}
      {isAdmin && (
        <section className="st-record-section">
          <h2 className="st-h2">Calendar link</h2>
          <p className="st-page-sub" style={{ marginBottom: 12 }}>
            A link anyone can subscribe to from Google Calendar, Outlook, or
            Apple Calendar &mdash; it shows only this one due date, and
            updates itself whenever the date above is moved. No account
            needed on their end.
          </p>
          <CalendarLinks obligationId={o.id} links={calendarLinks} />
        </section>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="st-ob-fact">
      <span className="st-ob-fact-label">{label}</span>
      <span className="st-ob-fact-value">{children}</span>
    </div>
  );
}

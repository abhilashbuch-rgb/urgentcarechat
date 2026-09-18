import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile, outstandingFor } from "@/lib/staff/compliance";
import { summary, type ObligationSummary } from "@/lib/staff/obligations";
import { ROLE_LABELS, atLeast, runsClinic, shortcutsFor, type NavItem } from "@/lib/staff/roles";
import { shiftState, myCredentialWarnings, type ShiftState, type ExpiringCredential } from "@/lib/staff/shift";
import { factOfTheDay } from "@/lib/staff/history-facts";
import { firstNameOf, formatSignedAt } from "@/lib/staff/labels";
import { currentAnnouncement } from "@/lib/staff/whats-new";
import { listBulletins, type Bulletin } from "@/lib/staff/bulletins";
import { onDutyToday, type OnDutyRole } from "@/lib/staff/roster-today";
import { activeRecallAlerts, CLASSIFICATION_EXPLANATION, type RecallAlert } from "@/lib/staff/recalls";
import StaffClock from "@/app/components/staff/StaffClock";
import ShortcutGrid from "@/app/components/staff/ShortcutGrid";
import OnCallStrip from "@/app/components/staff/OnCallStrip";

// The staff landing screen — one shift, from the point of view of the
// person working it.
//
// It used to show the org's name, the size of the team, and a row count
// read back through row-level security: a demonstration that the plumbing
// worked, printed on the screen of somebody who came to log a fridge
// temperature before the doors open. What is here now is what they owe
// this shift, one tap to the next of it, and anything expiring that is
// theirs rather than the clinic's.

export const dynamic = "force-dynamic";

interface Overview {
  // False for a multi-site owner who has switched into a clinic they
  // administer but have never worked a shift at — staff.user_orgs grants
  // access without a staff.users row reachable through this session's
  // identity, on purpose (see supabase/staff-multisite.sql): a shift
  // board, credentials and onboarding all belong to somebody actually
  // working there, not to whoever happens to be signed in as its
  // administrator.
  hasProfile: boolean;
  /** Only fetched when !hasProfile — the one thing that view needs and
   *  the normal one does not (it says "Today", not the clinic's name). */
  orgName: string | null;
  /** For the "what's new" greeting. Null for the !hasProfile view, which
   *  never renders that callout. */
  firstName: string | null;
  /** Recent clinic notices — see lib/staff/bulletins.ts. Empty, not
   *  fetched at all, for the !hasProfile view. */
  bulletins: Bulletin[];
  /** Owner or manager by ROLE, or the centre admin by JOB — same gate
   *  the API route re-checks. Hides the compose box rather than showing
   *  it disabled, since most accounts will never see it. */
  canPost: boolean;
  outstanding: number;
  needsOnboarding: boolean;
  // Null for anyone who cannot open the register — the query is not run
  // at all rather than run and discarded.
  obligations: ObligationSummary | null;
  shift: ShiftState;
  credentials: ExpiringCredential[];
  timezone: string;
  /** shortcutsFor()'s own output for this person — see ShortcutGrid.tsx
   *  and the job-priority note on shortcutsFor() itself. Built here
   *  rather than in the component so it uses the same job_role the rest
   *  of this page already resolved, instead of a second lookup. */
  shortcuts: NavItem[];
  /** Who is scheduled today, by job — see lib/staff/roster-today.ts.
   *  Shown to everyone, not just admin-tier: a front desk hire on their
   *  third shift benefits from knowing who the MA on today is at least
   *  as much as an owner does. */
  onDuty: OnDutyRole[];
  /** FDA recalls matched against this clinic's own stocked inventory —
   *  see lib/staff/recalls.ts. Same visibility as onDuty above: a
   *  property of the clinic and its stock room, not of one person's
   *  shift, so shown to everyone who opens this board. */
  recalls: RecallAlert[];
}

export default async function StaffHome() {
  const { session, org } = await requireStaff();

  // Obligations moved off the staff nav: renewing the CLIA certificate is
  // not a medical assistant's job and a register they cannot act on is
  // noise on the one screen that has to stay short. The callouts below
  // follow the nav rather than contradicting it — pointing somebody at a
  // page they were just removed from is worse than not mentioning it.
  const seesObligations = atLeast(session.role, "clinical_lead");

  // Anyone at clinical_lead or above already has a working nav — Team,
  // Settings, Obligations — whether or not their own onboarding packet is
  // signed. Sending them to the wizard on every visit to "Home" trapped an
  // owner who needed to get back to Team and delete someone with no way
  // out but the browser's back button. A plain staff account has nowhere
  // else to go until it's done, so that one still bounces straight there.
  const hasNavAccess = atLeast(session.role, "clinical_lead");

  let overview: Overview | null = null;
  let dbError: string | null = null;

  try {
    overview = await withSession(session, async (sql) => {
      const profile = await getProfile(sql, session.uid);
      if (!profile) {
        // Administering this clinic, not working in it — see the
        // Overview.hasProfile comment. Nothing below the profile row
        // means anything for this person in this org, so it isn't
        // queried.
        const orgRow = await sql<
          { name: string; timezone: string; facility_type: string | null }[]
        >`
          select name, timezone, facility_type from staff.orgs where slug = ${org}
        `;
        return {
          hasProfile: false,
          orgName: orgRow[0]?.name ?? org,
          firstName: null,
          bulletins: [],
          canPost: false,
          outstanding: 0,
          needsOnboarding: false,
          obligations: null,
          shift: await shiftState(sql, null),
          credentials: [],
          timezone: orgRow[0]?.timezone ?? "America/New_York",
          shortcuts: shortcutsFor(session.role, null),
          onDuty: await onDutyToday(sql, org, orgRow[0]?.facility_type ?? null),
          recalls: await activeRecallAlerts(sql, org),
        };
      }
      const outstanding = await outstandingFor(sql, session.uid);
      const [orgRow] = await sql<
        { timezone: string; facility_type: string | null }[]
      >`
        select timezone, facility_type from staff.orgs where slug = ${org}
      `;
      return {
        hasProfile: true,
        orgName: null,
        firstName: firstNameOf(profile),
        bulletins: await listBulletins(sql),
        canPost: runsClinic(session.role, profile.job_role ?? null),
        shift: await shiftState(sql, profile.job_role ?? null),
        credentials: await myCredentialWarnings(sql, session.uid),
        outstanding: outstanding.length,
        needsOnboarding: !profile.esign_consented_at || !profile.legal_name,
        obligations: seesObligations ? await summary(sql, org) : null,
        timezone: orgRow?.timezone ?? "America/New_York",
        shortcuts: shortcutsFor(session.role, profile.job_role ?? null),
        onDuty: await onDutyToday(sql, org, orgRow?.facility_type ?? null),
        recalls: await activeRecallAlerts(sql, org),
      };
    });
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown error";
  }

  // First sign-in goes straight into the packet rather than to a
  // dashboard with a notification on it. Someone who has never consented
  // or signed anything has nothing to look at here yet, and a banner they
  // can dismiss is exactly how "we never knew" happens.
  if (overview?.needsOnboarding && !hasNavAccess) redirect("/staff/onboarding");

  // Administering this clinic, not working a shift in it. Nobody files a
  // log here under this identity, so a board framed around "what do I
  // owe this shift" would be showing them somebody else's screen.
  if (overview && !overview.hasProfile) {
    return (
      <div className="st-page">
        <header className="st-page-head st-page-head-row">
          <div>
            <h1 className="st-h1">{overview.orgName}</h1>
            <p className="st-page-sub">
              Signed in as {session.email} &middot; {ROLE_LABELS[session.role]}
            </p>
          </div>
          <OnCallStrip onDuty={overview.onDuty} />
        </header>
        <div className="st-notice" role="status">
          <strong>You administer this clinic.</strong>
          <span>
            You haven&rsquo;t been invited to work a shift here, so there is
            no board of your own to show &mdash; that&rsquo;s normal for a
            second location you run but don&rsquo;t staff yourself. Add
            people, set it up, or switch to another clinic below.
          </span>
        </div>
        <div className="st-board-action" style={{ marginTop: 16 }}>
          <Link className="st-board-btn" href="/staff/team">
            Invite staff
          </Link>
          <Link className="st-board-btn st-board-btn-later" href="/staff/settings">
            Clinic settings
          </Link>
          <Link className="st-board-btn st-board-btn-later" href="/staff/settings/clinics">
            Your clinics
          </Link>
        </div>
      </div>
    );
  }

  const whatsNew = overview?.hasProfile ? currentAnnouncement() : null;

  return (
    <div className="st-page">
      <header className="st-page-head st-page-head-row">
        <div>
          {/* "Today", not the org name — the header above already says
              which clinic this is, and repeating it here gave the screen
              two headings that said the same thing. Matching the nav item
              means the page title and the tab you clicked agree. */}
          <h1 className="st-h1">Today</h1>
          <p className="st-page-sub">
            Signed in as {session.email} &middot; {ROLE_LABELS[session.role]}
          </p>
          {overview && <StaffClock timezone={overview.timezone} />}
        </div>
        {/* Top-right, at a glance, without scrolling past today's
            callouts to reach .st-onduty further down. Same data, same
            silent-when-empty rule — see OnCallStrip.tsx. */}
        <OnCallStrip onDuty={overview?.onDuty ?? []} />
      </header>

      {/* One fact, once a day, not a stream. Rotates on the clinic's own
          calendar day — see lib/staff/history-facts.ts for why nothing
          here is generated or date-specific ("on this day...") claims
          this file cannot verify. */}
      {overview && (
        <p className="st-history-fact">{factOfTheDay(overview.timezone)}</p>
      )}

      {/* SHORT-LIVED, ON PURPOSE. whatsNew is null once WINDOW_DAYS has
          passed since it shipped — see lib/staff/whats-new.ts — so this
          is not a fourth permanent thing competing for the top of the
          screen. First thing under the header while it's live, because
          the point is that it gets seen, not read about later. */}
      {whatsNew && (
        <Link className="st-callout st-callout-new" href={whatsNew.href}>
          <span className="st-callout-badge">New</span>
          <span className="st-callout-title">
            Hi{overview?.firstName ? `, ${overview.firstName}` : ""} &mdash;
            here&rsquo;s what&rsquo;s new
          </span>
          <span className="st-callout-sub">
            {whatsNew.blurb} {whatsNew.cta} &rarr;
          </span>
        </Link>
      )}

      {/* Only reachable by clinical_lead+ — see hasNavAccess above. A plain
          staff account with needsOnboarding never gets here; it was
          redirected before this render. */}
      {overview?.needsOnboarding && (
        <div className="st-notice st-notice-warn" role="status">
          <strong>Your own onboarding packet is still open.</strong>
          <span>
            The clinic below is fully usable &mdash; Team, Settings and
            everything else &mdash; but your consent and signature aren&rsquo;t
            on file yet.
          </span>
          <Link className="st-btn st-notice-action" href="/staff/onboarding">
            Finish onboarding &rarr;
          </Link>
        </div>
      )}

      {dbError && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>The staff database isn&rsquo;t reachable</strong>
          <span>
            Run <code>supabase/staff-schema.sql</code>, then set{" "}
            <code>STAFF_DATABASE_URL</code> to the <code>staff_app</code> role.
            The sign-in above still worked, so the session and org resolution
            are fine &mdash; only the data layer is missing.
          </span>
          <span className="st-notice-detail">{dbError}</span>
        </div>
      )}

      {overview && overview.outstanding > 0 && (
        <a className="st-callout" href="/staff/onboarding">
          <span className="st-callout-title">
            {overview.outstanding === 1
              ? "1 document is waiting for your signature"
              : `${overview.outstanding} documents are waiting for your signature`}
          </span>
          <span className="st-callout-sub">
            Review and sign them &rarr;
          </span>
        </a>
      )}

      {/* An overdue obligation is the one thing on this screen that is
          already a finding rather than a task. It sits above the cards
          for that reason, and it names the count rather than showing a
          dot, because a dot is something you stop seeing. */}
      {overview?.obligations && overview.obligations.overdue > 0 && (
        <Link className="st-callout st-callout-warn" href="/staff/obligations">
          <span className="st-callout-title">
            {overview.obligations.overdue === 1
              ? "1 obligation is overdue"
              : `${overview.obligations.overdue} obligations are overdue`}
          </span>
          <span className="st-callout-sub">Open the register &rarr;</span>
        </Link>
      )}

      {overview?.obligations &&
        overview.obligations.overdue === 0 &&
        overview.obligations.due_soon > 0 && (
          <Link className="st-callout" href="/staff/obligations">
            <span className="st-callout-title">
              {overview.obligations.due_soon === 1
                ? "1 obligation is due in the next 30 days"
                : `${overview.obligations.due_soon} obligations are due in the next 30 days`}
            </span>
            <span className="st-callout-sub">Open the register &rarr;</span>
          </Link>
        )}

      {/* A RECALL ON SOMETHING THIS CLINIC ACTUALLY STOCKS, NOT A NEWS
          FEED. See lib/staff/recalls.ts for why this is matched only
          against named inventory items rather than generic equipment
          categories — the deliberate scope limit that keeps this list
          short enough to actually read. Worst classification first;
          each row explains what that class means rather than assuming
          the reader has FDA's severity scale memorized, and links to
          the literal openFDA record rather than a guessed-at public
          page URL. Shown to everyone on this board, same as On duty
          below — a recalled vaccine lot in the fridge is exactly as
          much whoever gives it needs to know as it is an owner's. */}
      {overview && overview.recalls.length > 0 && (
        <section className="st-recall-section">
          <h2 className="st-h2">Recalls on what you stock</h2>
          <ul className="st-recall-list">
            {overview.recalls.map((r) => (
              <li
                key={r.id}
                className={`st-recall-row${
                  r.classification === "Class I" ? " st-recall-row-critical" : " st-recall-row-warn"
                }`}
              >
                <div className="st-recall-main">
                  <span className="st-recall-item">{r.itemName}</span>
                  {r.classification && (
                    <span className="st-recall-badge">{r.classification}</span>
                  )}
                </div>
                {r.classification && CLASSIFICATION_EXPLANATION[r.classification] && (
                  <p className="st-recall-explain">
                    {CLASSIFICATION_EXPLANATION[r.classification]}
                  </p>
                )}
                <p className="st-recall-desc">{r.productDescription}</p>
                {r.reasonForRecall && (
                  <p className="st-recall-reason">
                    <strong>Reason:</strong> {r.reasonForRecall}
                  </p>
                )}
                <p className="st-recall-meta">
                  {r.recallingFirm ?? "Manufacturer not listed"}
                  {r.reportDate ? ` · reported ${r.reportDate}` : ""}
                  {r.detailUrl && (
                    <>
                      {" · "}
                      <a href={r.detailUrl} target="_blank" rel="noopener noreferrer">
                        View the FDA record
                      </a>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* WHO'S EXPECTED, NOT WHO'S CLOCKED IN. Read from the schedule an
          administrator set on each person's Team page (workdays), not
          from any sign-in — see lib/staff/roster-today.ts. Informational
          rather than urgent or personal, which is why it sits after the
          actionable callouts above and before the social Notices below.
          Shown to everyone: a front desk hire on their third shift wants
          to know who today's medical assistant is as much as an owner
          does. Silent, same as everything else here, when nobody has
          been scheduled at all yet. */}
      {overview && overview.onDuty.length > 0 && (
        <section className="st-onduty">
          <h2 className="st-h2">On duty today</h2>
          <ul className="st-onduty-list">
            {overview.onDuty.map((r) => (
              <li key={r.jobRole} className="st-onduty-row">
                <span className="st-onduty-role">{r.label}</span>
                <span className="st-onduty-people">
                  {r.people.map((p) => p.name).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ONE-WAY, ON PURPOSE — a posting board, not a chat. See
          supabase/staff-bulletins.sql for why: a reply thread the product
          keeps a copy of is an all-party-consent recording question under
          Pennsylvania law, and that needs an employment attorney's
          sign-off before it can exist. Nobody replies inside the product,
          so nothing here is a captured conversation between two people.
          Silent for everyone when there's nothing to post and nothing
          posted, same as the credentials section below. */}
      {overview?.hasProfile && (overview.canPost || overview.bulletins.length > 0) && (
        <section className="st-bulletins">
          <h2 className="st-h2">Notices</h2>

          {overview.canPost && (
            <form className="st-bulletin-form" method="POST" action="/api/staff/bulletins">
              <input type="hidden" name="action" value="post" />
              <textarea
                name="body"
                className="st-bulletin-input"
                placeholder='Post a notice for the team — e.g. "Fridge #2 is being serviced Thursday."'
                maxLength={500}
                rows={2}
                required
              />
              <button className="st-board-btn st-bulletin-post" type="submit">
                Post
              </button>
            </form>
          )}

          {overview.bulletins.length > 0 && (
            <ul className="st-bulletin-list">
              {overview.bulletins.map((b) => (
                <li key={b.id} className="st-bulletin-row">
                  <div className="st-bulletin-main">
                    <p className="st-bulletin-body">{b.body}</p>
                    <span className="st-bulletin-meta">
                      {b.author_name ?? b.author_email} &middot; {formatSignedAt(b.created_at)}
                    </span>
                  </div>
                  {overview.canPost && (
                    <form method="POST" action="/api/staff/bulletins">
                      <input type="hidden" name="action" value="delete" />
                      <input type="hidden" name="id" value={b.id} />
                      <button className="st-cust-btn" type="submit">
                        Remove
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* EVERYONE, SCOPED BY THE SAME navFor() THE DRAWER USES — see
          shortcutsFor() in lib/staff/roles.ts. A medical assistant's
          shortcuts are Logs, Rounds, Record an event, Documents, her
          own record — the job-relevant handful navFor() already
          filters down to for a plain staff role, just resequenced per
          job by shortcutsFor(). Nothing admin-only leaks in here; there
          is no second list to keep in sync, just the nav's own output
          laid out as tiles. An administrator's version also includes
          Team, Settings, and the rest they're entitled to — same
          mechanism, more items. */}
      {overview && overview.shortcuts.length > 0 && (
        <section className="st-shortcuts-section">
          <h2 className="st-h2">Shortcuts</h2>
          <ShortcutGrid items={overview.shortcuts} />
        </section>
      )}

      {/* THE SHIFT, NOT THE ORGANIZATION.
          What stood here was three cards explaining the software to the
          person using it — how the hostname resolves, how row-level
          security scopes a query. True, and written for whoever was
          building this rather than for a medical assistant at seven in
          the morning. */}
      {overview && overview.shift.due + overview.shift.done > 0 && (
        <section className="st-shift">
          <p className="st-shift-count">
            {overview.shift.due === 0
              ? "Everything due this shift is filed."
              : overview.shift.due === 1
                ? "1 check left this shift"
                : `${overview.shift.due} checks left this shift`}
          </p>
          {overview.shift.done > 0 && (
            <p className="st-shift-done">
              {overview.shift.done} already filed
              {overview.shift.flagged > 0 &&
                ` · ${overview.shift.flagged} out of range`}
            </p>
          )}

          {/* One tap to the next one. Today, then Logs, then find the
              row, then open it was four taps before a number could be
              typed — on a screen whose whole claim is fifteen seconds. */}
          {overview.shift.next && (
            <Link
              className="st-primary st-shift-go"
              href={`/staff/logs/${overview.shift.next.slug}${
                overview.shift.next.slot
                  ? `?slot=${overview.shift.next.slot}`
                  : ""
              }`}
            >
              Start: {overview.shift.next.name}
            </Link>
          )}
        </section>
      )}

      {/* THEIRS, NOT THE CLINIC'S.
          The one thing on this screen that serves the person reading it:
          their card, their licence, their problem if it lapses. Silent
          when nothing is approaching, because a permanent green row is
          another thing to stop seeing. */}
      {overview && overview.credentials.length > 0 && (
        <section className="st-mycreds">
          <h2 className="st-h2">Your credentials</h2>
          <ul className="st-mycred-list">
            {overview.credentials.map((c) => (
              <li key={c.kind_label} className={`st-mycred st-mycred-${c.status}`}>
                <span className="st-mycred-kind">{c.kind_label}</span>
                <span className="st-mycred-state">
                  {c.status === "missing"
                    ? "Not on file"
                    : c.status === "expired"
                      ? "Expired"
                      : c.days_left === 1
                        ? "Expires tomorrow"
                        : `Expires in ${c.days_left} days`}
                </span>
              </li>
            ))}
          </ul>
          <Link className="st-mycred-go" href="/staff/documents">
            Update your documents
          </Link>
        </section>
      )}

      <p className="st-foot">
        This area is separate from the patient symptom checker, which stays
        anonymous: no accounts, no records, nothing here connected to it.
      </p>
    </div>
  );
}

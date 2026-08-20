import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { atLeast } from "@/lib/staff/roles";
import {
  credentials, screens, rosterRisk,
  KIND_LABELS, SOURCE_LABELS, expiryLabel, screenLabel,
} from "@/lib/staff/credentials";
import { formatDate } from "@/lib/staff/labels";
import RecordScreen from "@/app/components/staff/RecordScreen";

// The roster's risk surface.
//
// Two questions a payer or a surveyor asks that nothing else in this app
// could answer: is anyone working on an expired credential, and can you
// show me you screened this roster against the exclusion list.
//
// Both are ordered worst-first and neither hides what is fine — a page
// that shows only problems cannot answer "prove you checked".

export const dynamic = "force-dynamic";

export default async function RosterPage() {
  const { session, org } = await requireStaff();
  if (!atLeast(session.role, "clinical_lead")) {
    return (
      <div className="st-page">
        <header className="st-page-head">
          <h1 className="st-h1">Roster</h1>
          <p className="st-page-sub">
            Credential and screening records are visible to clinical leads and
            administrators.
          </p>
        </header>
      </div>
    );
  }

  const { creds, scr, risk } = await withSession(session, async (sql) => ({
    creds: await credentials(sql),
    scr: await screens(sql),
    risk: await rosterRisk(sql, org),
  }));

  const problems = creds.filter((c) => c.status === "expired" || c.status === "critical");
  const watch = creds.filter((c) => c.status === "expiring" || c.status === "no_date");
  const fine = creds.filter((c) => c.status === "current");
  const dueScreens = scr.filter((s) => s.status !== "current");
  const doneScreens = scr.filter((s) => s.status === "current");
  const canRecord = atLeast(session.role, "org_admin");

  return (
    <div className="st-page">
      <header className="st-page-head st-record-head">
        <div>
          <h1 className="st-h1">Roster</h1>
          <p className="st-page-sub">
            Credentials and exclusion screening for everyone on the active
            roster.
          </p>
        </div>
        {/* The binder download lives here rather than on its own page:
            this is the screen somebody is already on when an inspector
            asks for the record. A plain link, not a fetch — the browser
            streams the PDF straight to disk and a 40-page render never
            has to be held in a JavaScript buffer first. */}
        <a
          className="st-btn st-btn-primary"
          href="/api/staff/accreditation?days=90"
        >
          Export 90-day binder
        </a>
      </header>

      <section className="st-stats">
        <Stat n={risk.expired} label="Expired" tone={risk.expired ? "bad" : "ok"} />
        <Stat n={risk.expiring_30} label="Expiring in 30 days" tone={risk.expiring_30 ? "warn" : "ok"} />
        <Stat n={risk.screens_due} label="Screenings due" tone={risk.screens_due ? "warn" : "ok"} />
        <Stat n={risk.screens_flagged} label="Screening flags" tone={risk.screens_flagged ? "bad" : "ok"} />
      </section>

      {risk.expired > 0 && (
        <div className="st-notice st-notice-warn" role="alert">
          <strong>
            {risk.expired === 1
              ? "Someone is working on an expired credential"
              : `${risk.expired} credentials on the roster have expired`}
          </strong>
          <span>
            An expired licence or certification is not a paperwork problem — it
            is the thing a payer recoups against and an insurer declines cover
            for. Start the renewal, and record the new date here.
          </span>
        </div>
      )}

      <Group title="Expired and expiring" blurb="Worst first. These are what a finding is written about." rows={problems} />
      <Group title="Watch" blurb="Inside 90 days, or no expiry recorded at all." rows={watch} />
      <Group title="Current" blurb="Kept visible, because “prove you checked” needs the whole roster, not just the problems." rows={fine} />

      <section className="st-ob-group">
        <h2 className="st-h2">
          Exclusion screening
          <span className="st-ob-count">{scr.length}</span>
        </h2>
        <p className="st-ob-blurb">
          A federal programme pays for nothing an excluded person furnishes,
          orders, prescribes or merely helps with — so this covers the whole
          roster, not just prescribers. The OIG asks for a screen on hire and
          monthly after.
        </p>
        <ul className="st-board">
          {[...dueScreens, ...doneScreens].map((s) => (
            <li
              key={`${s.user_id}-${s.source}`}
              className={`st-board-row${s.status === "current" ? " st-board-done" : ""}${
                s.status === "flagged" ? " st-board-flag" : ""
              }`}
            >
              <div className="st-board-main">
                <span className="st-board-name">
                  {s.legal_name ?? s.email}
                  <span className="st-board-slot">{SOURCE_LABELS[s.source]}</span>
                </span>
                <span className="st-board-meta">
                  {screenLabel(s)}
                  {s.checked_on && ` · ${formatDate(s.checked_on)}`}
                </span>
              </div>
              <div className="st-board-action">
                <span className={`st-pill ${pillFor(s.status)}`}>{statusWord(s.status)}</span>
                {canRecord && <RecordScreen userId={s.user_id} source={s.source} name={s.legal_name ?? s.email} />}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="st-foot">
        Credential numbers are deliberately not stored. Expiry tracking needs
        the kind, the issuer and the date; a table of DEA registrations against
        named prescribers is a fraud kit, and holding one would make this system
        a target rather than a record.
      </p>
    </div>
  );
}

function statusWord(s: string) {
  return { expired: "Expired", critical: "Urgent", expiring: "Soon", current: "OK",
           no_date: "No date", never: "Never", overdue: "Due", flagged: "Flagged" }[s] ?? s;
}
function pillFor(s: string) {
  if (s === "expired" || s === "flagged" || s === "critical") return "st-pill-due";
  if (s === "current") return "st-pill-ok";
  return "st-pill-new";
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`st-stat st-stat-${tone}`}>
      <span className="st-stat-n">{n}</span>
      <span className="st-stat-l">{label}</span>
    </div>
  );
}

function Group({
  title, blurb, rows,
}: {
  title: string; blurb: string;
  rows: Awaited<ReturnType<typeof credentials>>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="st-ob-group">
      <h2 className="st-h2">
        {title}
        <span className="st-ob-count">{rows.length}</span>
      </h2>
      <p className="st-ob-blurb">{blurb}</p>
      <ul className="st-board">
        {rows.map((c) => (
          <li
            key={c.credential_id}
            className={`st-board-row${c.status === "current" ? " st-board-done" : ""}${
              c.status === "expired" ? " st-board-flag" : ""
            }`}
          >
            <div className="st-board-main">
              <span className="st-board-name">
                {c.legal_name ?? c.email}
                <span className="st-board-slot">{KIND_LABELS[c.kind] ?? c.kind}</span>
              </span>
              <span className="st-board-meta">
                {expiryLabel(c.days_left, c.status)}
                {c.expires_on && ` · ${formatDate(c.expires_on)}`}
                {c.issuer && ` · ${c.issuer}`}
                {c.verified_on
                  ? ` · verified ${formatDate(c.verified_on)}`
                  : " · not source-verified"}
              </span>
            </div>
            <div className="st-board-action">
              <span className={`st-pill ${pillFor(c.status)}`}>{statusWord(c.status)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

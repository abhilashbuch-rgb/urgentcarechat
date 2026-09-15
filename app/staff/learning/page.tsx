import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile, facilityTypeFor, zipFor } from "@/lib/staff/compliance";
import { emergencyGuides } from "@/lib/staff/rounds";
import { jobPhrase, atLeast } from "@/lib/staff/roles";
import { emergencyContactsFor } from "@/lib/staff/emergency-contacts";
import ProtocolSearch from "@/app/components/staff/ProtocolSearch";

// Emergency action guides — and, folded in below them, clinical
// protocol search. Two features that used to be two separate nav
// entries and two separate pages; combined here into one door because
// they were the two items under "reference material for a shift" and
// having both listed read as more redundancy than the actual gap
// between them (open to everyone vs. clinical staff only) justified.
//
// EVERY STEP OF EVERY GUIDE IS ON THE PAGE. No stepper, no Next button,
// no attestation, and nothing collapsed by default. That is the exact
// opposite of the round runner and it is the correct opposite: the
// runner hides the next step so a walk cannot be faked from the counter,
// and here there is nothing to fake and everything to lose. Somebody
// needs to see that step 4 is "call 911" before they have finished step
// 1, and a paginated anaphylaxis procedure is a procedure that gets
// abandoned halfway.
//
// NOBODY SIGNS ANYTHING HERE. Asking a person to confirm paperwork while
// a patient is losing an airway is how they learn to close the app in an
// emergency, which loses the one moment it exists for. The database
// refuses a run against these outright — see the trigger in
// supabase/staff-emergency.sql.
//
// THE EMERGENCY GUIDES THEMSELVES STAY A STATIC SERVER RENDER with no
// client JavaScript, so they render on a bad connection in a back
// corridor. The protocol search below them is its own client component,
// same as it always was on its own page — combining the two pages does
// not make the guides depend on it; collapsed inside a plain <details>,
// it costs nothing until somebody who can use it actually opens it.

export const dynamic = "force-dynamic";

export default async function LearningPage() {
  const { session, org } = await requireStaff();

  const { guides, jobRole, facilityType, contacts, zip } = await withSession(
    session,
    async (sql) => {
      const me = await getProfile(sql, session.uid);
      const job = me?.job_role ?? null;
      return {
        jobRole: job,
        guides: await emergencyGuides(sql, job),
        facilityType: await facilityTypeFor(sql, org),
        contacts: await emergencyContactsFor(sql, org),
        zip: await zipFor(sql, org),
      };
    }
  );

  const phrase = jobRole ? jobPhrase(jobRole, facilityType) : null;

  // Same audience Protocols always had on its own page: a provider or
  // centre admin by job, or a clinical lead or above by role. Nobody
  // else even sees the section exists — this is a fold-in, not a
  // widening of who protocol search is for.
  const clinical = jobRole === "provider" || jobRole === "center_admin";
  const seesProtocols = clinical || atLeast(session.role, "clinical_lead");

  return (
    <div className="st-page">
      <header className="st-page-head">
        <h1 className="st-h1">Emergencies</h1>
        <p className="st-page-sub">
          {phrase
            ? `What to do, ${phrase}. Read now, not during.`
            : "What to do. Read now, not during."}
        </p>
      </header>

      {/* ABOVE EVERYTHING ELSE ON THE PAGE, ON PURPOSE. A guide tells you
          what to do; these are who to call while you're doing it. See
          staff-emergency-contacts.sql — every number here is one this
          clinic actually typed in, never looked up on its behalf. */}
      {contacts.length > 0 && (
        <section className="st-emc-list" aria-label="Emergency numbers">
          <h2 className="st-h2">
            Emergency numbers{zip ? ` for ${zip}` : ""}
          </h2>
          <ul className="st-emc-tiles">
            {contacts.map((c) => (
              <li key={c.id}>
                <a className="st-emc-tile" href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`}>
                  <span className="st-emc-tile-label">{c.label}</span>
                  <span className="st-emc-tile-phone">{c.phone}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Said once, at the top, and it is the most important sentence on
          the page. A guide read for the first time during the emergency
          is a guide being read too slowly. */}
      <div className="st-notice" role="status">
        <strong>These are worth reading before you need them</strong>
        <span>
          Nothing here is signed for and nothing is recorded when you open it.
          It is a reference, and it is faster than the binder because you are
          already holding it.
        </span>
      </div>

      {guides.length === 0 && (
        <p className="st-empty">
          {jobRole
            ? "No emergency guides are set up for your job yet."
            : "Your account has no job set yet, so nothing is assigned to you. Ask an administrator to set it."}
        </p>
      )}

      {guides.map((g) => (
        <section key={g.key} className="st-emg" id={g.key}>
          <header className="st-emg-head">
            <h2 className="st-emg-title">{g.title}</h2>
            {g.purpose && <p className="st-emg-purpose">{g.purpose}</p>}
          </header>

          <ol className="st-emg-steps">
            {g.steps.map((s) => (
              <li key={s.step_no} className="st-emg-step">
                <span className="st-emg-no">{s.step_no}</span>
                <div>
                  <p className="st-emg-instruction">{s.instruction}</p>
                  {s.detail && <p className="st-emg-detail">{s.detail}</p>}
                </div>
              </li>
            ))}
          </ol>

          {/* Provenance on every guide. These seed from published
              guidance and are not this clinic's approved procedure until
              somebody local approves them, and a guide that hides that
              is a guide claiming an authority it does not have. */}
          <p className="st-emg-review">
            Not yet reviewed by your medical director. Numbers that vary by
            clinic or state — paediatric dosing, poison control, which
            hospital takes transfers — say where to look rather than guessing.
          </p>
        </section>
      ))}

      {/* Folded in from the old standalone /staff/protocols page —
          collapsed by default, same reason as .st-board-hidden and
          .st-act-notify elsewhere in the app: zero JS to render closed,
          and closed on every fresh load rather than remembering it was
          open last time. Rendered only for the audience that page ever
          allowed; not shown at all, not shown-then-refused, for anyone
          else. */}
      {seesProtocols && (
        <details className="st-emg-protocols" id="protocols">
          <summary>Protocols</summary>
          <p className="st-page-sub" style={{ marginTop: 8 }}>
            Your clinic&rsquo;s protocols and the guidance loaded alongside
            them, searchable. Results are the text as written, with its
            source.
          </p>
          <ProtocolSearch />
          <p className="st-sign-fine">
            This searches documents. It does not give advice, work out a
            dose, or know anything about the patient in front of you
            &mdash; it finds the passage and shows you who wrote it and
            when.
          </p>
        </details>
      )}
    </div>
  );
}

import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { emergencyGuides } from "@/lib/staff/rounds";
import { JOB_PHRASES } from "@/lib/staff/roles";

// Emergency action guides.
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
// AND IT IS A STATIC SERVER PAGE with no client JavaScript, so it
// renders on a bad connection in a back corridor.

export const dynamic = "force-dynamic";

export default async function LearningPage() {
  const { session } = await requireStaff();

  const { guides, jobRole } = await withSession(session, async (sql) => {
    const me = await getProfile(sql, session.uid);
    const job = me?.job_role ?? null;
    return { jobRole: job, guides: await emergencyGuides(sql, job) };
  });

  const phrase = jobRole ? JOB_PHRASES[jobRole] ?? null : null;

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
    </div>
  );
}

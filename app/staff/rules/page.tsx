import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { rulesFor } from "@/lib/staff/rules";
import { JOB_PHRASES } from "@/lib/staff/roles";

// Standing rules: what this job may do, what it may never do, and the
// directives it works under.
//
// SCOPE COMES FIRST AND THE PROHIBITED COLUMN IS NOT SOFTENED. The two
// columns are the reason this page exists. A new hire at the desk is not
// going to read fourteen paragraphs of directive on their third shift,
// but they will read two short lists — and it is the right-hand list
// that keeps an unlicensed person from answering a clinical question
// because the lobby was full and it seemed helpful.
//
// Every prohibited item is printed with the sentence to say instead.
// That pairing is enforced in the database, not just here: a rule with
// no sanctioned alternative loses to a queue, because the patient is
// still standing there wanting an answer.

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const { session } = await requireStaff();

  const { rules, jobRole } = await withSession(session, async (sql) => {
    const me = await getProfile(sql, session.uid);
    const job = me?.job_role ?? null;
    return { jobRole: job, rules: await rulesFor(sql, job) };
  });

  const jobPhrase = jobRole ? JOB_PHRASES[jobRole] ?? null : null;
  const critical = rules.directives.filter((d) => d.critical);
  const rest = rules.directives.filter((d) => !d.critical);

  return (
    <div className="st-page">
      <header className="st-page-head">
        <h1 className="st-h1">Standing rules</h1>
        <p className="st-page-sub">
          {jobPhrase
            ? `What applies to you ${jobPhrase}.`
            : "The rules that apply to everyone here."}
        </p>
      </header>

      {/* No job assigned is a real state and it is shown loudly. The
          alternative — falling back to showing every job's scope — would
          tell somebody unlicensed that clinical work is theirs to do. */}
      {!jobRole && (
        <div className="st-notice st-notice-warn" role="status">
          <strong>No job assigned to your account yet</strong>
          <span>
            Scope of practice is per job, so there is nothing to show you
            until an administrator sets yours. Until then you are seeing
            only the rules that apply to everybody. Ask your administrator
            to set your job on the Team page.
          </span>
        </div>
      )}

      {jobRole && (
        <section className="st-scope">
          <div className="st-scope-col st-scope-yes">
            <h2 className="st-h2">
              Yours to do
              <span className="st-scope-count">{rules.authorized.length}</span>
            </h2>
            <ul className="st-scope-list">
              {rules.authorized.map((s) => (
                <li key={s.key} className="st-scope-item">
                  <span className="st-scope-text">{s.item}</span>
                  {s.citation && (
                    <span className="st-scope-cite">{s.citation}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="st-scope-col st-scope-no">
            <h2 className="st-h2">
              Never yours
              <span className="st-scope-count">{rules.prohibited.length}</span>
            </h2>
            <ul className="st-scope-list">
              {rules.prohibited.map((s) => (
                <li key={s.key} className="st-scope-item">
                  <span className="st-scope-text">{s.item}</span>
                  {/* The alternative, not an afterthought — this is the
                      half somebody actually uses at the window. */}
                  {s.instead && (
                    <span className="st-scope-instead">{s.instead}</span>
                  )}
                  {s.citation && (
                    <span className="st-scope-cite">{s.citation}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {critical.length > 0 && (
        <section className="st-section">
          <h2 className="st-h2">Get these wrong and it is an incident</h2>
          <div className="st-rule-list">
            {critical.map((d) => (
              <Directive key={d.key} d={d} />
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section className="st-section">
          <h2 className="st-h2">Standing directives</h2>
          <div className="st-rule-list">
            {rest.map((d) => (
              <Directive key={d.key} d={d} />
            ))}
          </div>
        </section>
      )}

      {rules.directives.length === 0 && (
        <p className="st-empty">No directives have been set for this clinic.</p>
      )}
    </div>
  );
}

function Directive({
  d,
}: {
  d: {
    title: string;
    body: string;
    rationale: string | null;
    citation: string | null;
    critical: boolean;
    everyone: boolean;
  };
}) {
  return (
    <article className={`st-rule${d.critical ? " st-rule-critical" : ""}`}>
      <h3 className="st-rule-title">
        {d.title}
        {d.everyone && <span className="st-rule-tag">Everyone</span>}
      </h3>
      <p className="st-rule-body">{d.body}</p>
      {/* The reason, kept with the rule. A directive that carries why it
          exists survives the shift where somebody decides it is
          pointless; one that does not is followed until it is
          inconvenient. */}
      {d.rationale && <p className="st-rule-why">{d.rationale}</p>}
      {d.citation && <p className="st-rule-cite">{d.citation}</p>}
    </article>
  );
}


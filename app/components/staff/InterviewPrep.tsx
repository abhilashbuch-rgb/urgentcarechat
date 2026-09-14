import { jobLabel } from "@/lib/staff/roles";
import type { InterviewQA } from "@/lib/staff/interview-prep";

export interface RolePrep {
  jobRole: string;
  qas: InterviewQA[];
}

/** Collapsed by role, same shape as .st-board-hidden and .st-act-notify
 *  elsewhere in the app — a plain <details> disclosure rather than a
 *  client-side accordion, so this renders with zero JS and starts
 *  closed on every fresh load. */
export default function InterviewPrep({
  roles,
  facilityType,
}: {
  roles: RolePrep[];
  facilityType: string | null;
}) {
  const withAnswers = roles.filter((r) => r.qas.length > 0);
  if (withAnswers.length === 0) return null;

  return (
    <section className="st-panel">
      <h2 className="st-h2">Surveyor interview prep</h2>
      <p className="st-panel-sub">
        The kind of question a surveyor actually asks on the floor, answered
        from this clinic&rsquo;s own{" "}
        <a href="/staff/rules">standing rules</a> &mdash; the same rules
        staff see there, not a second version to rehearse.
      </p>
      {withAnswers.map((r) => (
        <details key={r.jobRole} className="st-interview-role">
          <summary>
            {jobLabel(r.jobRole, facilityType)}
            <span className="st-scope-count">{r.qas.length}</span>
          </summary>
          <div className="st-rule-list">
            {r.qas.map((qa, i) => (
              <article key={i} className="st-rule">
                <h3 className="st-rule-title">{qa.question}</h3>
                <p className="st-rule-body">{qa.answer}</p>
                {qa.rationale && <p className="st-rule-why">{qa.rationale}</p>}
                {qa.citation && <p className="st-rule-cite">{qa.citation}</p>}
              </article>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}

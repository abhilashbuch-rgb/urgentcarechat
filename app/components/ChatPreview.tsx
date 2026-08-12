// Static, non-interactive replica of a real triage session, used as the
// hero visual on the root landing page. Deliberately not the live
// TriageApp: this renders instantly with no API calls, and shows a
// complete conversation (symptom -> triage -> routed clinic) that a real
// session would take several turns to reach.
//
// Classes are `cp-` prefixed and self-contained so this can never
// collide with the live chat's styles in globals.css.
export default function ChatPreview() {
  return (
    <div className="cp-frame" role="img" aria-label="Preview of a urgentcare.chat triage conversation ending in a routed clinic recommendation">
      <div className="cp-chrome">
        <span className="cp-dot" />
        <span className="cp-dot" />
        <span className="cp-dot" />
        <span className="cp-url">afc.urgentcare.chat</span>
      </div>

      <div className="cp-disclaimer">
        <strong>Not a doctor.</strong> If this is an emergency, call 911.
      </div>

      <div className="cp-body">
        <div className="cp-row cp-row-user">
          <div className="cp-bubble cp-user">
            my son has an earache and a low fever since last night
          </div>
        </div>

        <div className="cp-row">
          <div className="cp-bubble cp-bot">
            How old is he, and has the fever gone above 102&deg;F?
          </div>
        </div>

        <div className="cp-row cp-row-user">
          <div className="cp-bubble cp-user">6 — it&apos;s been around 100.5</div>
        </div>

        <div className="cp-row">
          <div className="cp-bubble cp-bot">
            <span className="cp-care-badge">Urgent &middot; seen today</span>
            An ear infection at that age is very treatable, but it does need
            someone to look in his ear. Here&apos;s the closest location that
            can see him now:
          </div>
        </div>

        <div className="cp-clinic">
          <span className="cp-clinic-tag">Nearest in network</span>
          <div className="cp-clinic-name">AFC Urgent Care Narberth</div>
          <div className="cp-clinic-meta">
            <span>0.4 mi</span>
            <span className="cp-sep" aria-hidden="true">&middot;</span>
            <span className="cp-open">Open &middot; closes 8 PM</span>
            <span className="cp-sep" aria-hidden="true">&middot;</span>
            <span>&#9733; 4.6</span>
            <span className="cp-sep" aria-hidden="true">&middot;</span>
            <span className="cp-wait">Wait ~15 min</span>
          </div>
          <div className="cp-tags">
            <span className="cp-tag">pediatric</span>
            <span className="cp-tag">x-ray</span>
            <span className="cp-tag">lab</span>
            <span className="cp-tag">aetna</span>
          </div>
          <div className="cp-actions">
            <span className="cp-btn">Directions</span>
            <span className="cp-btn cp-btn-ghost">Call</span>
          </div>
        </div>
      </div>
    </div>
  );
}

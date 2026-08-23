import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile, outstandingFor, loadDoc } from "@/lib/staff/compliance";
import { renderPolicyMarkdown } from "@/lib/staff/markdown";
import { getTenantBySlug } from "@/lib/tenants";
import ProfileForm from "@/app/components/staff/ProfileForm";
import SignatureForm from "@/app/components/staff/SignatureForm";
import JobConfirm from "@/app/components/staff/JobConfirm";
import CredentialDates from "@/app/components/staff/CredentialDates";
import Orientation from "@/app/components/staff/Orientation";
import { CATEGORY_LABELS } from "@/lib/staff/labels";
import { JOB_LABELS } from "@/lib/staff/roles";
import {
  onboardingState,
  stepFor,
  requirementsFor,
  type Step,
} from "@/lib/staff/onboarding";

// The onboarding wizard: five gates, one screen at a time.
//
//   profile      legal name and consent to sign electronically
//   job          confirm the job the invite assigned
//   credentials  expiry dates for what that job requires
//   documents    the policy packet, one document per screen
//   orientation  four cards on what the app is, then you are in
//
// ORDER IS NOT ARBITRARY. The job decides which credentials get asked
// for; the documents are signed under the legal name the profile step
// establishes. Each gate depends on the one before it.
//
// THE SERVER DECIDES WHICH STEP YOU ARE ON. There is no wizard state in
// the browser and no step number in the URL — each request recomputes
// what is still outstanding and renders the first of them. That makes the
// back button, a refresh, a second tab, and a phone that went to sleep
// mid-signature all behave correctly without any of them being handled
// specially. It also means a step cannot be skipped by editing a URL,
// because there is no URL to edit.

export const dynamic = "force-dynamic";

export default async function Onboarding() {
  const { session, org } = await requireStaff();
  const tenant = await getTenantBySlug(org);
  const orgName = tenant?.displayName ?? org;

  const state = await withSession(session, async (sql) => {
    const profile = await getProfile(sql, session.uid);
    const gates = await onboardingState(sql, session.uid);
    const step: Step = gates ? stepFor(gates) : "profile";

    // Only load what the current step renders. The document packet is
    // the expensive read and there is no reason to do it while somebody
    // is still typing their name.
    const outstanding =
      step === "documents" ? await outstandingFor(sql, session.uid) : [];
    const next =
      outstanding.length > 0 ? await loadDoc(sql, outstanding[0].doc_id) : null;

    const requirements =
      step === "credentials" && profile?.job_role
        ? await requirementsFor(sql, session.uid, profile.job_role)
        : [];

    // The two short lists shown on the job step, so confirming a job
    // means more than recognising a title. Three of each: enough to
    // recognise the shape of the job, short enough to actually read.
    const scope =
      step === "job" && profile?.job_role
        ? await sql<{ kind: string; item: string }[]>`
            select kind, item from staff.scope_of_practice
             where job_role = ${profile.job_role}::staff.job_role
             order by sort_order
          `
        : [];
    // How many documents apply to this person in total, not just how many
    // are left. Deriving the step count from what's outstanding alone made
    // the denominator shrink as you went — "step 2 of 7" became "step 2 of
    // 1" — so the bar never moved and the count counted down.
    const assigned = await sql<{ count: string }[]>`
      select assigned_count::text as count from staff.compliance_status
       where user_id = ${session.uid}
    `;
    return {
      profile,
      gates,
      step,
      outstanding,
      next,
      requirements,
      scope: {
        authorized: scope
          .filter((r) => r.kind === "authorized")
          .slice(0, 3)
          .map((r) => r.item),
        prohibited: scope
          .filter((r) => r.kind === "prohibited")
          .slice(0, 3)
          .map((r) => r.item),
      },
      assignedCount: Number(assigned[0]?.count ?? outstanding.length),
    };
  });

  // Nothing left to do. Onboarding is not a place to linger.
  if (state.step === "done") redirect("/staff");

  // Three fixed steps (profile, job, credentials) plus one per applicable
  // document plus the orientation. Counted from the gates rather than
  // from what is outstanding: deriving the denominator from what is left
  // made it shrink as you went, so "step 2 of 7" became "step 2 of 1"
  // and the bar never moved.
  const FIXED_BEFORE = 3;
  const total = FIXED_BEFORE + state.assignedCount + 1;
  const done = stepsDone(state.step, state.assignedCount, state.outstanding.length);

  const jobLabel = state.profile?.job_role
    ? JOB_LABELS[state.profile.job_role] ?? state.profile.job_role
    : null;

  return (
    <div className="st-page st-page-narrow">
      <header className="st-onb-head">
        <p className="st-onb-eyebrow">{orgName} &middot; Onboarding</p>
        <h1 className="st-h1">{HEADINGS[state.step] ?? state.next?.title}</h1>
        <Progress done={done} total={total} />
      </header>

      {state.step === "profile" ? (
        <>
          <p className="st-onb-intro">
            A few minutes: your name, your job, when your certifications
            expire, then the policies to read and sign. You can stop and come
            back &mdash; everything is saved as you go.
          </p>
          <ProfileForm
            defaultLegalName={state.profile?.legal_name ?? state.profile?.name ?? ""}
          />
        </>
      ) : state.step === "job" && !state.gates?.job_unassigned && jobLabel && state.profile?.job_role ? (
        <JobConfirm
          jobLabel={jobLabel}
          jobRole={state.profile.job_role}
          scope={state.scope}
        />
      ) : state.step === "job" ? (
        // The invite carried no job — an older invite, or a domain-wide
        // one where the inviter could not know who would use it. Shown
        // as the blocking gap it is rather than waved through, because a
        // person with no job sees an almost-empty board and reasonably
        // concludes the app is broken.
        <div className="st-notice st-notice-warn" role="status">
          <strong>Your invite didn&rsquo;t say what you do here</strong>
          <span>
            Ask whoever invited you to set your job. It decides which logs
            and rounds are yours, so nothing else can start until it is set.
          </span>
        </div>
      ) : state.step === "credentials" ? (
        <>
          <p className="st-onb-intro">
            When your current certifications run out. Dates only &mdash; this
            app never asks for a licence or certificate number.
          </p>
          <CredentialDates requirements={state.requirements} />
        </>
      ) : state.step === "orientation" ? (
        <>
          <p className="st-onb-intro">
            Everything is signed. Four screens on what this app is, and then
            you are in.
          </p>
          <Orientation />
        </>
      ) : state.next ? (
        <>
          <div className="st-doc-meta">
            {state.next.category && (
              <span className="st-tag">
                {CATEGORY_LABELS[state.next.category] ?? state.next.category}
              </span>
            )}
            {state.next.citation && (
              <span className="st-doc-citation">{state.next.citation}</span>
            )}
            {state.outstanding[0]?.reason === "expired" && (
              <span className="st-tag st-tag-due">Annual renewal</span>
            )}
          </div>

          <article
            className="st-doc"
            dangerouslySetInnerHTML={{
              __html: renderPolicyMarkdown(state.next.body_md),
            }}
          />

          <SignatureForm
            docId={state.next.doc_id}
            attestation={state.next.attestation}
            defaultName={state.profile?.legal_name ?? ""}
            remaining={state.outstanding.length}
          />

          {state.outstanding.length > 1 && (
            <p className="st-onb-rest">
              After this: {state.outstanding.slice(1, 4).map((d) => d.title).join(", ")}
              {state.outstanding.length > 4 &&
                `, and ${state.outstanding.length - 4} more`}
              .
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

const HEADINGS: Partial<Record<Step, string>> = {
  profile: "Before you start",
  job: "Your job here",
  credentials: "Your certifications",
  orientation: "How this works",
};

/** How many gates are behind you. The document steps count individually
 *  so the bar moves once per signature rather than jumping at the end. */
function stepsDone(step: Step, assigned: number, outstanding: number): number {
  switch (step) {
    case "profile":
      return 0;
    case "job":
      return 1;
    case "credentials":
      return 2;
    case "documents":
      return 3 + (assigned - outstanding);
    case "orientation":
      return 3 + assigned;
    default:
      return 3 + assigned + 1;
  }
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="st-progress" aria-label={`Step ${done + 1} of ${total}`}>
      <div className="st-progress-track">
        <div
          className="st-progress-fill"
          style={{ width: `${Math.round((done / total) * 100)}%` }}
        />
      </div>
      <span className="st-progress-label">
        Step {done + 1} of {total}
      </span>
    </div>
  );
}

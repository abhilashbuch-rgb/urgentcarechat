import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile, outstandingFor, loadDoc } from "@/lib/staff/compliance";
import { renderPolicyMarkdown } from "@/lib/staff/markdown";
import { getTenantBySlug } from "@/lib/tenants";
import ProfileForm from "@/app/components/staff/ProfileForm";
import SignatureForm from "@/app/components/staff/SignatureForm";
import { CATEGORY_LABELS } from "@/lib/staff/labels";

// The onboarding packet, one document at a time.
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
    const outstanding = await outstandingFor(sql, session.uid);
    const next =
      outstanding.length > 0 ? await loadDoc(sql, outstanding[0].doc_id) : null;
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
      outstanding,
      next,
      assignedCount: Number(assigned[0]?.count ?? outstanding.length),
    };
  });

  const needsProfile =
    !state.profile?.esign_consented_at || !state.profile?.legal_name;

  // Nothing left to do. Onboarding is not a place to linger.
  if (!needsProfile && state.outstanding.length === 0) redirect("/staff/me");

  // The profile step is step one, then one step per applicable document.
  const total = state.assignedCount + 1;
  const done =
    (needsProfile ? 0 : 1) + (state.assignedCount - state.outstanding.length);

  return (
    <div className="st-page st-page-narrow">
      <header className="st-onb-head">
        <p className="st-onb-eyebrow">{orgName} &middot; Onboarding</p>
        <h1 className="st-h1">
          {needsProfile ? "Before you start" : state.next?.title}
        </h1>
        <Progress done={done} total={total} />
      </header>

      {needsProfile ? (
        <>
          <p className="st-onb-intro">
            You&rsquo;re about to read and sign {state.outstanding.length}{" "}
            {state.outstanding.length === 1 ? "document" : "documents"}. It
            takes about {Math.max(5, state.outstanding.length * 3)} minutes.
            You can stop and come back &mdash; everything you sign is saved as
            you go.
          </p>
          <ProfileForm
            defaultLegalName={state.profile?.legal_name ?? state.profile?.name ?? ""}
            defaultJobTitle={state.profile?.job_title ?? ""}
            orgName={orgName}
          />
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

import BrandLockup from "@/app/components/BrandLockup";
import { redirect } from "next/navigation";
import { resolve } from "@/lib/staff/auth";
import { isConfigured } from "@/lib/staff/google";
import EmailSignIn from "@/app/components/staff/EmailSignIn";

// Sign-in, and every way sign-in can fail.
//
// Each message says what happened and what to do about it. "Something
// went wrong" on an internal tool means a phone call to whoever built it,
// so the failure modes are named — including the ones that are the
// operator's fault rather than the user's.

const MESSAGES: Record<string, { title: string; body: string }> = {
  no_org: {
    title: "Your account isn't attached to a clinic",
    body: "Sign-in worked, but your account has no organization. An administrator has to assign you to one before there's anything to show you.",
  },
  wrong_org: {
    title: "Signed in somewhere else",
    body: "Your session doesn't match your current organization. Sign out and sign back in.",
  },
  ambiguous: {
    title: "Your email is set up at more than one clinic",
    body: "That's a situation this can't resolve on its own without risking putting you in the wrong clinic's records. Ask an administrator to remove the duplicate.",
  },
  no_invite: {
    title: "That account hasn't been invited",
    body: "Sign-in is limited to people your administrator has invited. If you think that's you, ask them to add your work email — and check you picked the right Google account.",
  },
  revoked: {
    title: "Your session ended",
    body: "Your access was changed or your sessions were signed out. Sign in again — if that doesn't work, your account was deactivated and an administrator has to switch it back on.",
  },
  wrong_domain: {
    title: "Use your work Google account",
    body: "This organization only accepts sign-ins from its own Google Workspace domain. A personal Gmail account won't work here, even one that has been invited.",
  },
  deactivated: {
    title: "That account has been turned off",
    body: "Your access to this organization was deactivated. An administrator can switch it back on — a new invitation isn't needed.",
  },
  cancelled: {
    title: "Sign-in cancelled",
    body: "You closed Google's sign-in screen before it finished.",
  },
  unverified_email: {
    title: "Unverified Google address",
    body: "Google hasn't verified that address belongs to you, so it can't be used here.",
  },
  bad_state: {
    title: "That sign-in link expired",
    body: "Sign-in requests are good for ten minutes. Start again.",
  },
  exchange_failed: {
    title: "Google didn't complete the sign-in",
    body: "This usually means this hostname isn't listed as an authorized redirect URI in the Google Cloud console.",
  },
  unconfigured: {
    title: "Sign-in isn't set up yet",
    body: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET aren't set on this deployment.",
  },
  server_error: {
    title: "Couldn't reach the staff database",
    body: "Check STAFF_DATABASE_URL and that supabase/staff-schema.sql has been run.",
  },
};

export default async function StaffSignIn({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  // Already signed in and in the right place — the sign-in page has
  // nothing to offer.
  const existing = await resolve();
  if (existing.ok) redirect("/staff");

  const { e } = await searchParams;
  const message = e ? MESSAGES[e] : undefined;

  // One staff door for every clinic, so the only thing that can stop the
  // button appearing is the server missing its OAuth credentials — which
  // is not something pressing a button would fix.
  const canSignIn = isConfigured();

  return (
    <div className="st-signin">
      <div className="st-signin-card">
        {/* The lockup, not the name set as an eyebrow. This is the one
            screen a new hire sees before they are inside anything, so
            it is the screen that has to look like the product rather
            than describe it. */}
        <div className="st-signin-brand">
          <BrandLockup tagline />
        </div>
        <h1 className="st-signin-title">Staff sign-in</h1>
        {/* Says what this is, not what it isn't. The previous line
            explained that patients don't need an account — true, but it
            described a symptom checker that is no longer what this
            product is for. The people reading this screen are clinical
            staff about to file a log. */}
        <p className="st-signin-sub">
          Clinical and operational records for your clinic. Access is by
          invitation from your administrator.
        </p>

        {message && (
          <div className="st-notice" role="status">
            <strong>{message.title}</strong>
            <span>{message.body}</span>
          </div>
        )}

        {/* TWO DOORS INTO ONE CORRIDOR.
            Google where the clinic has Workspace — it brings their own
            hardware keys, device policy and session revocation for free
            and there is nothing for us to store.
            An emailed code for everyone else. A great many urgent cares
            run Microsoft 365, and for those clinics a Google-only screen
            was not a login, it was a wall.
            NEITHER GRANTS ACCESS. Both prove you hold an address; the
            invite decides whether that address may come in. */}
        {canSignIn && (
          <>
            <a className="st-google" href="/api/staff/auth/start">
              <GoogleMark />
              Continue with Google
            </a>
            <div className="st-or">
              <span>or</span>
            </div>
          </>
        )}

        <EmailSignIn />

        {!canSignIn && !message && (
          <p className="st-signin-fine">
            Google sign-in isn&rsquo;t configured on this deployment, so the
            emailed code is the way in. It works with any work address &mdash;
            Microsoft, Google or anything else.
          </p>
        )}

        <p className="st-signin-fine">
          Access is by invitation. Proving you hold the address doesn&rsquo;t
          grant access on its own &mdash; your administrator has to have
          invited it.
        </p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-1.9 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3.1-6.7 5.2-.1.3C7.9 41 15.4 46 24 46"
      />
      <path
        fill="#FBBC05"
        d="M11.5 28.4c-.5-1.4-.8-3-.8-4.4s.3-3 .7-4.4v-.3l-6.8-5.3-.2.1C2.9 17 2 20.4 2 24s.9 7 2.4 9.9z"
      />
      <path
        fill="#EA4335"
        d="M24 10.4c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.1 29.9 2 24 2 15.4 2 7.9 7 4.4 14.1l7 5.5c1.8-5.3 6.8-9.2 12.6-9.2"
      />
    </svg>
  );
}

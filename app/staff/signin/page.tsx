import { redirect } from "next/navigation";
import { resolve, hostOrg } from "@/lib/staff/auth";
import { getTenantBySlug } from "@/lib/tenants";
import { isConfigured } from "@/lib/staff/google";

// Sign-in, and every way sign-in can fail.
//
// Each message says what happened and what to do about it. "Something
// went wrong" on an internal tool means a phone call to whoever built it,
// so the failure modes are named — including the ones that are the
// operator's fault rather than the user's.

const MESSAGES: Record<string, { title: string; body: string }> = {
  no_org: {
    title: "Open your clinic's own address",
    body: "The staff area lives on your organization's hostname — for AFC that's afc.urgentcare.chat/staff. This address doesn't belong to one organization, so there's nothing to sign in to.",
  },
  wrong_org: {
    title: "Signed in somewhere else",
    body: "Your session belongs to a different organization than this address. Sign out and sign back in here.",
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
  const org = await hostOrg();
  const tenant = org ? await getTenantBySlug(org) : null;
  const message = e ? MESSAGES[e] : undefined;

  // Two different "can't sign in" cases: there's no org here at all, or
  // the server is missing its OAuth credentials. Neither is fixed by
  // pressing a button, so neither gets one.
  const canSignIn = Boolean(org) && isConfigured();

  return (
    <div className="st-signin">
      <div className="st-signin-card">
        <p className="st-signin-eyebrow">
          {tenant?.displayName ?? "urgentcare.chat"}
        </p>
        <h1 className="st-signin-title">Staff sign-in</h1>
        <p className="st-signin-sub">
          For clinic staff only. Patients don&rsquo;t need an account &mdash; the
          symptom checker never asks for one.
        </p>

        {message && (
          <div className="st-notice" role="status">
            <strong>{message.title}</strong>
            <span>{message.body}</span>
          </div>
        )}

        {canSignIn ? (
          <a className="st-google" href="/api/staff/auth/start">
            <GoogleMark />
            Continue with Google
          </a>
        ) : (
          !message && (
            <div className="st-notice" role="status">
              <strong>{MESSAGES.no_org.title}</strong>
              <span>{MESSAGES.no_org.body}</span>
            </div>
          )
        )}

        <p className="st-signin-fine">
          Access is by invitation. Signing in with Google proves who you are;
          it doesn&rsquo;t grant access on its own.
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

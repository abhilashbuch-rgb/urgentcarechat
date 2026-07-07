import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase-server-auth";
import { createServerClient } from "@/lib/supabase";
import AvailabilityToggle from "./AvailabilityToggle";
import SignOutButton from "./SignOutButton";
import ConnectButton from "./ConnectButton";

// Server component — reads the session via the cookie-aware client,
// then uses the service-role client for telehealth_requests (which
// has no anon/authenticated RLS policy at all; every read for it goes
// through trusted server code with an explicit provider_id filter,
// not through client-side RLS).
export default async function ProviderDashboardPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/provider/login");

  const admin = createServerClient();
  const { data: provider } = await admin
    .from("providers")
    .select("id, name, is_active, is_available, stripe_onboarded")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!provider) redirect("/provider/login?error=no-account");

  const { data: requests } = await admin
    .from("telehealth_requests")
    .select("id, created_at, status, payout_status, amount_cents, visit_note_submitted_at, emr_push_status, note_token")
    .eq("provider_id", provider.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="lux-shell">
      <header className="lux-header">
        <div className="brand lux-brand">
          <span className="dot"></span>urgentcare
          <span className="tld">.chat</span>
        </div>
        <div className="header-actions">
          <Link href="/provider/profile" className="lang-toggle">Edit profile</Link>
          <SignOutButton />
        </div>
      </header>

      <main className="lux-main">
        <div className="lux-card">
          <h1 className="lux-card-title">Welcome, {provider.name}</h1>

          {!provider.is_active && (
            <p className="lux-callout">
              Your NPI hasn&apos;t been verified yet — reach out to whoever
              set up your account. You won&apos;t appear to patients until
              that&apos;s done.
            </p>
          )}

          {provider.is_active && !provider.stripe_onboarded && (
            <div className="lux-callout">
              <p style={{ marginBottom: 10 }}>
                Set up payouts to receive your $30 per completed call.
              </p>
              <ConnectButton />
            </div>
          )}

          {provider.is_active && <AvailabilityToggle providerId={provider.id} initial={provider.is_available} />}
        </div>

        <div className="lux-card">
          <h2 className="lux-card-title">Recent requests</h2>
          {!requests || requests.length === 0 ? (
            <p className="lux-card-sub">No requests yet.</p>
          ) : (
            <div className="lux-request-list">
              {requests.map((r) => (
                <div key={r.id} className="lux-request-row">
                  <div>
                    <div className="lux-request-date">
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                    <div className="lux-request-meta">
                      ${(r.amount_cents / 100).toFixed(0)} · {r.status} · payout: {r.payout_status}
                    </div>
                  </div>
                  {r.visit_note_submitted_at ? (
                    <span className="lux-trust-badge">
                      Note{" "}
                      {r.emr_push_status === "pushed"
                        ? "sent to EMR"
                        : r.emr_push_status === "emailed"
                        ? "emailed to you"
                        : "submitted"}
                    </span>
                  ) : (
                    <Link className="lux-btn" style={{ display: "inline-block", padding: "8px 14px", fontSize: 12 }} href={`/provider/note?token=${r.note_token}`}>
                      Submit note
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

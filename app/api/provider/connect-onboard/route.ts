import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server-auth";
import { createServerClient } from "@/lib/supabase";
import { getOrCreateOnboardingLink } from "@/lib/stripe-connect";

// ============================================================
// /api/provider/connect-onboard — Self-service version of the admin
// endpoint: a logged-in provider can start their own Stripe Connect
// onboarding without needing ADMIN_SECRET. Auth comes from their own
// session, not a header — scoped to their own row only.
// ============================================================

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const admin = createServerClient();
    const { data: provider, error } = await admin
      .from("providers")
      .select("id, stripe_account_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (error || !provider) {
      return NextResponse.json({ error: "Provider account not found" }, { status: 404 });
    }

    const result = await getOrCreateOnboardingLink(
      provider.id,
      provider.stripe_account_id,
      req.nextUrl.origin,
      "/provider/dashboard"
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("[provider/connect-onboard] error:", err);
    return NextResponse.json({ error: "Failed to create onboarding link" }, { status: 500 });
  }
}

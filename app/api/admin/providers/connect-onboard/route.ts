import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getOrCreateOnboardingLink } from "@/lib/stripe-connect";

// ============================================================
// /api/admin/providers/connect-onboard — Creates (if needed) a Stripe
// Express connected account for a provider and returns a one-time
// onboarding link. Send that link to the provider so THEY enter their
// own bank details and identity info directly with Stripe — we never
// see or handle that data. Protected by ADMIN_SECRET.
//
// Providers can now also trigger this themselves from their dashboard
// (see /api/provider/connect-onboard) once logged in — this admin
// version remains for onboarding before they've ever logged in.
//
// Prerequisite you have to do yourself: your Stripe account needs
// Connect enabled (Dashboard → Connect → get started as a platform)
// before this will work.
// ============================================================

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { providerId } = await req.json();
    if (!providerId) {
      return NextResponse.json({ error: "Missing providerId" }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: provider, error } = await supabase
      .from("providers")
      .select("id, stripe_account_id")
      .eq("id", providerId)
      .maybeSingle();

    if (error || !provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const result = await getOrCreateOnboardingLink(
      provider.id,
      provider.stripe_account_id,
      req.nextUrl.origin,
      "/telehealth"
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("[admin/connect-onboard] error:", err);
    return NextResponse.json({ error: "Failed to create onboarding link" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server-auth";
import { createServerClient } from "@/lib/supabase";

// ============================================================
// /provider/auth/callback — Magic-link redirect target.
// Exchanges the emailed code for a session, then (first login only)
// links this auth user to the providers row with a matching email.
// The service-role client is used for that link because our RLS
// policy requires auth.uid() = auth_user_id, which is impossible to
// satisfy for the initial claim (auth_user_id starts null) — the
// link itself is safe because Supabase Auth already verified this
// person controls the inbox at that email, and only an admin (not the
// provider) ever sets providers.email in the first place.
// ============================================================

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const origin = req.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/provider/login`);
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user?.email) {
    return NextResponse.redirect(`${origin}/provider/login`);
  }

  const admin = createServerClient();
  const { data: provider } = await admin
    .from("providers")
    .select("id, auth_user_id")
    .ilike("email", data.user.email)
    .maybeSingle();

  if (provider && !provider.auth_user_id) {
    await admin
      .from("providers")
      .update({ auth_user_id: data.user.id })
      .eq("id", provider.id);
  }

  if (!provider) {
    return NextResponse.redirect(`${origin}/provider/login?error=no-account`);
  }

  return NextResponse.redirect(`${origin}/provider/dashboard`);
}

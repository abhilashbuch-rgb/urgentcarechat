import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase-server-auth";
import { createServerClient } from "@/lib/supabase";
import ProfileForm from "./ProfileForm";
import BrandIcon from "@/app/components/BrandIcon";

export default async function ProviderProfilePage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/provider/login");

  const admin = createServerClient();
  const { data: provider } = await admin
    .from("providers")
    .select("id, bio, credentials, specialty, years_experience, photo_url")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!provider) redirect("/provider/login?error=no-account");

  return (
    <div className="lux-shell">
      <header className="lux-header">
        <div className="brand lux-brand">
          <BrandIcon />
          urgentcare<span className="tld">.chat</span>
        </div>
        <Link href="/provider/dashboard" className="lang-toggle">
          &larr; Dashboard
        </Link>
      </header>

      <main className="lux-main" style={{ maxWidth: 480 }}>
        <ProfileForm providerId={provider.id} initial={provider} />
      </main>
    </div>
  );
}

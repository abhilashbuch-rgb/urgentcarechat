"use client";

import { createBrowserSupabase } from "@/lib/supabase-browser";

export default function SignOutButton() {
  const signOut = async () => {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    window.location.href = "/provider/login";
  };

  return (
    <button className="lang-toggle" onClick={signOut}>
      Sign out
    </button>
  );
}

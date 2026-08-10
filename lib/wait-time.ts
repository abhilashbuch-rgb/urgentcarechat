import { createServerClient } from "@/lib/supabase";

// Shared by /api/clinics (read, for display on clinic cards),
// /api/clinics/wait (read/write, via the private wait_token), and
// /clinics/wait/[token] (the staff self-report page). See
// supabase/schema.sql for why wait_token is separate from analytics_token.

export const WAIT_STALE_MINUTES = 120;

export type WaitSource = "manual" | "feed";

export interface WaitInfo {
  clinicId: string;
  clinicName: string;
  waitMinutes: number | null;
  waitUpdatedAt: string | null;
  waitSource: WaitSource | null;
  isStale: boolean;
}

export function isWaitStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return ageMs > WAIT_STALE_MINUTES * 60000;
}

export async function getWaitByToken(token: string): Promise<WaitInfo | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("clinics")
    .select("id, name, current_wait_minutes, wait_updated_at, wait_source")
    .eq("wait_token", token)
    .maybeSingle();

  if (error || !data) return null;

  return {
    clinicId: data.id,
    clinicName: data.name,
    waitMinutes: data.current_wait_minutes,
    waitUpdatedAt: data.wait_updated_at,
    waitSource: data.wait_source,
    isStale: isWaitStale(data.wait_updated_at),
  };
}

// waitMinutes: null clears the reading (e.g. "no data" / end of shift).
export async function updateWaitByToken(
  token: string,
  waitMinutes: number | null,
  source: WaitSource = "manual"
): Promise<boolean> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("clinics")
    .update({
      current_wait_minutes: waitMinutes,
      wait_updated_at: new Date().toISOString(),
      wait_source: source,
    })
    .eq("wait_token", token)
    .select("id")
    .maybeSingle();

  return !error && !!data;
}

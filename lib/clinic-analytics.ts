import { createServerClient } from "@/lib/supabase";

// Shared by /api/clinics/analytics and /clinics/analytics/[token] — looks
// up a clinic by its private analytics_token and summarizes its last 30
// days of click activity, plus a network-wide rollup across every
// location sharing the same brand (see supabase/schema.sql).

export interface ClickSummary {
  total: number;
  byType: Record<string, number>;
  dailyCounts: { date: string; count: number }[];
}

export interface ClinicAnalytics {
  clinic: { name: string; brand: string | null; isFeatured: boolean; waitToken: string };
  location: ClickSummary;
  network: (ClickSummary & { locationCount: number }) | null;
}

interface ClickRow {
  event_type: string;
  created_at: string;
}

function summarize(rows: ClickRow[]): ClickSummary {
  const byType: Record<string, number> = {};
  const byDay: Record<string, number> = {};

  for (const row of rows) {
    byType[row.event_type] = (byType[row.event_type] || 0) + 1;
    const day = row.created_at.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }

  return {
    total: rows.length,
    byType,
    dailyCounts: Object.entries(byDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function getClinicAnalytics(token: string): Promise<ClinicAnalytics | null> {
  const supabase = createServerClient();

  const { data: clinic, error: clinicErr } = await supabase
    .from("clinics")
    .select("id, name, brand, is_featured, wait_token")
    .eq("analytics_token", token)
    .maybeSingle();

  if (clinicErr || !clinic) return null;

  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data: ownClicks } = await supabase
    .from("clicks")
    .select("event_type, created_at")
    .eq("clinic_id", clinic.id)
    .gte("created_at", since);

  const location = summarize(ownClicks || []);
  let network: ClinicAnalytics["network"] = null;

  if (clinic.brand) {
    const { data: siblings } = await supabase
      .from("clinics")
      .select("id")
      .eq("brand", clinic.brand);

    const siblingIds = (siblings || []).map((s) => s.id);

    if (siblingIds.length > 1) {
      const { data: networkClicks } = await supabase
        .from("clicks")
        .select("event_type, created_at")
        .in("clinic_id", siblingIds)
        .gte("created_at", since);

      network = { ...summarize(networkClicks || []), locationCount: siblingIds.length };
    }
  }

  return {
    clinic: {
      name: clinic.name,
      brand: clinic.brand,
      isFeatured: !!clinic.is_featured,
      waitToken: clinic.wait_token,
    },
    location,
    network,
  };
}

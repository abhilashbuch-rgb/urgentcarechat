import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenants";
import { getTenantLocations, type TenantLocation } from "@/lib/tenant-locations";
import { getTodaysReads } from "@/lib/health-reads";
import TenantPortal from "@/app/components/TenantPortal";
import { type HealthTopic } from "@/lib/medlineplus";

// Dynamic because the tenant, its config, and its locations all live in the
// database — a config change should show up on the next request, not the
// next deploy.
export const dynamic = "force-dynamic";

export default async function TenantPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const sections = tenant.config.sections ?? [];

  // Only fetch what this tenant's config actually renders. A portal that's
  // just a chat box shouldn't be paying for a MedlinePlus round trip.
  const wantsLocations = sections.some((s) => s.type === "locations");
  const readsSection = sections.find((s) => s.type === "reads");
  const readsCount = readsSection?.type === "reads" ? readsSection.count ?? 3 : 0;

  let locations: TenantLocation[] = [];
  let reads: HealthTopic[] = [];

  const [locRes, readsRes] = await Promise.allSettled([
    wantsLocations ? getTenantLocations(tenant.slug) : Promise.resolve([]),
    readsCount > 0 ? getTodaysReads(readsCount) : Promise.resolve([]),
  ]);

  if (locRes.status === "fulfilled") locations = locRes.value;
  if (readsRes.status === "fulfilled") reads = readsRes.value;

  return <TenantPortal tenant={tenant} locations={locations} reads={reads} />;
}

import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenants";
import TriageApp from "@/app/components/TriageApp";

export const dynamic = "force-dynamic";

export default async function TenantPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  return <TriageApp tenant={tenant} />;
}

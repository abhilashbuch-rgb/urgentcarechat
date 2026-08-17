import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenants";
import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/site";

// Validates the tenant slug for everything under /t/[tenant] — reached
// either directly, or via proxy.ts rewriting a request to
// afc.urgentcare.chat into /t/afc. An unknown/inactive slug here means
// proxy's own lookup is stale (its cache is short-lived) or someone
// hit this path directly; either way, 404 rather than guessing.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string }>;
}): Promise<Metadata> {
  const { tenant: slug } = await params;
  const tenant = await getTenantBySlug(slug);
  return {
    title: tenant ? `${tenant.displayName} — powered by ${PRODUCT_NAME}` : "Not found",
    robots: { index: false, follow: false },
  };
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  return children;
}

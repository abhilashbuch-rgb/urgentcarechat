import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { loadTemplate } from "@/lib/staff/logs";
import { getProfile } from "@/lib/staff/compliance";
import { SLOT_LABELS, currentSlot } from "@/lib/staff/forms";
import { CATEGORY_LABELS } from "@/lib/staff/labels";
import LogForm from "@/app/components/staff/LogForm";
import type { GeofenceMode, OrgGeofence } from "@/lib/staff/geo";

export const dynamic = "force-dynamic";

export default async function LogPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ slot?: string; amend?: string }>;
}) {
  const { session } = await requireStaff();
  const { slug } = await params;
  const { slot: requestedSlot, amend: amendId } = await searchParams;

  const data = await withSession(session, async (sql) => ({
    template: await loadTemplate(sql, slug),
    // The entry being corrected, when the URL names one. Read through
    // the same session as everything else, so RLS decides whether this
    // person may see it — a response id in a URL must not be a way to
    // read another clinic's record.
    amending: amendId
      ? (
          await sql<
            {
              id: string;
              answers_json: Record<string, unknown>;
              submitted_at: string;
              filed_by: string | null;
            }[]
          >`
            select r.id, r.answers_json,
                   r.submitted_at::text as submitted_at,
                   u.legal_name as filed_by
              from staff.form_responses r
              left join staff.users u on u.id = r.submitted_by
             where r.id = ${amendId}
               and not exists (
                 select 1 from staff.form_responses newer
                  where newer.supersedes_id = r.id
               )
          `
        )[0] ?? null
      : null,
    profile: await getProfile(sql, session.uid),
    // Where the clinic is, so the form can tell the person whether they
    // are at it before they file rather than after. The radius and mode
    // are the clinic's own settings — see supabase/staff-geofence.sql for
    // why this records rather than blocks.
    geo: (
      await sql<
        {
          latitude: number | null;
          longitude: number | null;
          geofence_radius_m: number;
          geofence_mode: GeofenceMode;
        }[]
      >`
        select latitude, longitude, geofence_radius_m, geofence_mode
          from staff.orgs where slug = ${session.org}
      `
    )[0],
  }));

  if (!data.template) notFound();
  const { template } = data;

  // Which shift this entry belongs to. A form with no slots is once a day
  // and takes none; otherwise the URL decides, defaulting to the shift
  // we're actually in.
  const slot =
    template.slots.length === 0
      ? ""
      : template.slots.includes(requestedSlot ?? "")
        ? requestedSlot!
        : template.slots.includes(currentSlot())
          ? currentSlot()
          : template.slots[0];

  // Signing a compliance log under a name nobody would recognise defeats
  // the point, so the packet comes first.
  if (!data.profile?.legal_name) redirect("/staff/onboarding");

  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });

  // A clinic row that predates the migration has no mode; treat that as
  // off rather than as a reason to prompt everybody for location.
  const geofence: OrgGeofence = {
    lat: data.geo?.latitude ?? null,
    lng: data.geo?.longitude ?? null,
    radiusM: data.geo?.geofence_radius_m ?? 150,
    mode: data.geo?.geofence_mode ?? "off",
  };

  return (
    <div className="st-page st-page-narrow">
      <header className="st-onb-head">
        <p className="st-onb-eyebrow">
          <Link href="/staff/logs">Logs</Link>
          {template.category && ` · ${CATEGORY_LABELS[template.category] ?? template.category}`}
        </p>
        <h1 className="st-h1">{template.name}</h1>
        {template.description && (
          <p className="st-page-sub">{template.description}</p>
        )}
      </header>

      <LogForm
        slug={template.slug}
        slot={slot}
        schema={template.schema}
        signedBy={data.profile.legal_name}
        todayLabel={todayLabel}
        slotLabel={SLOT_LABELS[slot] ?? "Today"}
        geofence={geofence}
        amend={
          data.amending
            ? {
                responseId: data.amending.id,
                answers: data.amending.answers_json as Record<
                  string,
                  string | number | boolean | null
                >,
                filedAtLabel: new Date(
                  data.amending.submitted_at
                ).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "America/New_York",
                }),
                filedByName: data.amending.filed_by ?? "a colleague",
              }
            : undefined
        }
      />
    </div>
  );
}

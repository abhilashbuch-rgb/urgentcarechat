import { NextRequest, NextResponse } from "next/server";
import { redeemCalendarToken, currentOccurrence } from "@/lib/staff/obligation-calendar";
import { getTenantBySlug } from "@/lib/tenants";
import { buildCalendar } from "@/lib/staff/ics";

// GET /api/obligations-calendar/[token] — a subscribable calendar feed
// for one obligation.
//
// PUBLIC, ON PURPOSE. A calendar app fetches this itself, on its own
// polling schedule, with no session and no way to present one — a
// bearer token in the URL is the credential, same reasoning as
// /surveyor/[token]. See supabase/staff-obligation-calendar.sql for how
// the token is scoped (one obligation key, not the register) and why it
// never expires (a subscription is meant to keep working until an
// administrator revokes it).
//
// ALWAYS 200 WITH A VALID, POSSIBLY EMPTY CALENDAR for anything past
// "the token itself doesn't exist" — a calendar app that gets an error
// back from a feed it already subscribed to tends to drop the
// subscription rather than retry it, and "nothing is currently due"
// is a legitimate state, not a broken one.

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const redeemed = await redeemCalendarToken(token);
  if (!redeemed) {
    return NextResponse.json({ error: "unknown_or_revoked" }, { status: 404 });
  }

  const [tenant, occurrence] = await Promise.all([
    getTenantBySlug(redeemed.org),
    currentOccurrence(redeemed.org, redeemed.key),
  ]);

  const clinicName = tenant?.displayName ?? redeemed.org;
  const calName = `${clinicName} — compliance schedule`;

  const ics = buildCalendar(
    calName,
    occurrence
      ? [
          {
            uid: `obligation-${redeemed.org}-${redeemed.key}@medicin.io`,
            title: occurrence.title,
            description: [occurrence.detail, occurrence.citation]
              .filter(Boolean)
              .join("\n\n"),
            dueOn: occurrence.due_on,
          },
        ]
      : []
  );

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${redeemed.key}.ics"`,
      "cache-control": "no-store",
    },
  });
}

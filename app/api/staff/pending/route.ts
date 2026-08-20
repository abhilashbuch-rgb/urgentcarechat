import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";

// GET  /api/staff/pending — what is due for me, and is the clinic open
// POST /api/staff/pending — set my own sound preference
//
// THE OPEN/CLOSED ANSWER COMES FROM HERE, NOT THE DEVICE. A phone with
// the wrong timezone, or a nurse opening the app on holiday, would
// otherwise chime at the wrong hour or not at all. The server evaluates
// the clinic's own IANA zone — see staff.within_operating_hours().
//
// AND IT IS SCOPED TO THE CALLER'S JOB. A medical assistant is not
// reminded about the front desk's drawer count, which is the same
// separation rule the board and the rounds already follow.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  return withSession(session, async (sql) => {
    const me = await getProfile(sql, session.uid);
    const jobRole = me?.job_role ?? null;

    const [openRow] = await sql<{ open: boolean }[]>`
      select staff.within_operating_hours(${org}) as open
    `;

    // KEYED BY TEMPLATE **AND SLOT**. todays_logs has one row per slot,
    // so a task with both an AM and a PM slot appears twice — and the
    // first version of this query selected slug and name only, which
    // returned two identical entries reading as a duplicate bug. Worse,
    // the late check joined on template_id alone, so an outstanding AM
    // count marked the evening's count late at 9am.
    const due = await sql<
      { slug: string; slot: string; name: string; late: boolean }[]
    >`
      select l.slug, l.slot, l.name,
             exists (
               select 1 from staff.overdue_today o
                where o.template_id = l.template_id
                  and o.slot = l.slot
             ) as late
        from staff.todays_logs l
       where l.response_id is null
         and staff.brief_matches(l.job_roles, ${jobRole}::staff.job_role)
       order by l.sort_order, l.slot
    `;

    return NextResponse.json({ open: openRow?.open ?? false, due });
  });
}

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session } = auth.ctx;

  const body = await req.json().catch(() => null);
  if (typeof body?.audio_alerts_enabled !== "boolean") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  // Own row only. There is no user parameter, so there is no way to
  // express turning somebody else's reminders off.
  await withSession(session, (sql) =>
    sql`
      update staff.users
         set audio_alerts_enabled = ${body.audio_alerts_enabled},
             -- Stamped when sound goes off, cleared when it comes back.
             -- staff.audio_off_now reads this, and the digest reads that.
             audio_muted_at = ${body.audio_alerts_enabled ? null : new Date().toISOString()}
       where id = ${session.uid}
    `
  );

  return NextResponse.json({ ok: true });
}

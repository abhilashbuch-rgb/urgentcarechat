import { NextRequest, NextResponse } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { atLeast } from "@/lib/staff/roles";
import { searchProtocols, logQuery, scrubQuery } from "@/lib/staff/protocols";

// GET /api/staff/protocols?q=… — search the clinic's protocol library.
//
// WHO CAN SEARCH: providers, and clinical leads and administrators.
// Not because the text is secret — most of it is public guidance — but
// because a search box full of clinical protocol is an invitation for
// somebody whose scope of practice explicitly excludes clinical
// judgement to look up an answer and give it at the desk. The front-desk
// scope says "get a clinical staff member"; handing the same person a
// wound-care protocol undermines the sentence the app just taught them.
//
// Every result is still filtered by staff.brief_matches on the reader's
// JOB, so an x-ray tech with a clinical lead's role sees imaging
// protocols and not pharyngitis.
//
// NOT GATED BY READ-ONLY. A lapsed card pauses new submissions; it does
// not take a clinician's protocol reference away mid-shift. Same rule as
// the obligations register.

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  const { session, org } = auth.ctx;

  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (raw.length < 2) {
    return NextResponse.json({ hits: [] });
  }

  return withSession(session, async (sql) => {
    const me = await getProfile(sql, session.uid);
    const jobRole = me?.job_role ?? null;

    const clinical = jobRole === "provider" || jobRole === "center_admin";
    if (!clinical && !atLeast(session.role, "clinical_lead")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const hits = await searchProtocols(sql, raw.slice(0, 200), jobRole);

    // Scrubbed BEFORE it is written, not cleaned up later. A free-text
    // clinical box is where somebody eventually types a patient's name
    // and date of birth, and this product's central claim is that it
    // holds no PHI. See scrubQuery().
    await logQuery(sql, {
      org,
      userId: session.uid,
      q: scrubQuery(raw),
      hits: hits.length,
    }).catch(() => {
      // A failed analytics write must never cost a clinician their
      // search result mid-shift.
    });

    return NextResponse.json({ hits });
  });
}

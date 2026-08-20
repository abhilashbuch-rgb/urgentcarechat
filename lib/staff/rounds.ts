import type { StaffSql } from "@/lib/staff/db";

// Rounds: runbooks that are WALKED, one step at a time, and signed once
// at the end.
//
// See supabase/staff-rounds.sql for why there is no per-step record. In
// short: fourteen checkboxes on one screen can be satisfied at the
// counter without leaving it, which makes the record a lie that looks
// like evidence. One step at a time, with a single attestation at the
// end, is the shape of the paper round sheet this replaces.

export interface RoundSummary {
  id: string;
  key: string;
  /** 'round' is walked and signed; 'emergency' is read during an
   *  incident, all steps at once, with no attestation. See the header of
   *  supabase/staff-emergency.sql. */
  kind: "round" | "emergency";
  title: string;
  purpose: string | null;
  cadence: string;
  step_count: number;
  last_walked_at: string | null;
  last_walked_by: string | null;
  last_exception_count: number;
}

export interface RoundStep {
  step_no: number;
  instruction: string;
  detail: string | null;
}

export interface RoundDetail extends RoundSummary {
  steps: RoundStep[];
}

/** Every round this person's job walks.
 *
 *  Same filter as the board — staff.brief_matches() — so a round and a
 *  log are scoped by identical logic, and separation is strict: a round
 *  with no job attached is everyone's, and only that. */
export async function roundsFor(
  sql: StaffSql,
  jobRole: string | null
): Promise<RoundSummary[]> {
  return sql<RoundSummary[]>`
    select id, key, kind, title, purpose, cadence, step_count,
           last_walked_at::text as last_walked_at,
           last_walked_by, last_exception_count
      from staff.round_board
     where kind = 'round'
       and staff.brief_matches(job_roles, ${jobRole}::staff.job_role)
     order by sort_order, title
  `;
}

/** One round with its steps in walking order, or null if this person's
 *  job does not walk it. The job check is here and not only in the page,
 *  because a URL is guessable and the point of the whole module is that
 *  the front desk does not get handed clinical work by typing a path. */
export async function roundByKey(
  sql: StaffSql,
  key: string,
  jobRole: string | null
): Promise<RoundDetail | null> {
  const [round] = await sql<RoundSummary[]>`
    select id, key, kind, title, purpose, cadence, step_count,
           last_walked_at::text as last_walked_at,
           last_walked_by, last_exception_count
      from staff.round_board
     where key = ${key}
       and staff.brief_matches(job_roles, ${jobRole}::staff.job_role)
     limit 1
  `;
  if (!round) return null;

  const steps = await sql<RoundStep[]>`
    select step_no, instruction, detail
      from staff.round_steps
     where round_id = ${round.id}
     order by step_no
  `;
  return { ...round, steps };
}

export interface RoundException {
  step_no: number;
  note: string;
}

/** File a completed pass.
 *
 *  started_at comes from the client, which is the only place that knows
 *  when the person actually opened step 1 — but it is CLAMPED here: a
 *  start in the future, or more than four hours ago, is replaced with
 *  now. A client-supplied timestamp is a claim, and the gap between
 *  start and finish is the one signal this record carries about whether
 *  the walk happened, so it is not a claim worth taking on trust. */
export async function recordRun(
  sql: StaffSql,
  args: {
    org: string;
    roundId: string;
    userId: string;
    startedAt: Date;
    exceptions: RoundException[];
  }
): Promise<string> {
  const now = Date.now();
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  const claimed = args.startedAt.getTime();
  const started =
    Number.isFinite(claimed) && claimed <= now && now - claimed <= FOUR_HOURS
      ? new Date(claimed)
      : new Date(now);

  // sql.json(), NOT JSON.stringify(...)::jsonb. postgres.js binds a JS
  // string as a JSON string, so the cast produced a jsonb STRING
  // containing "[{...}]" rather than a jsonb array — which the
  // exceptions_shape CHECK in staff-rounds.sql rejected, which is the
  // only reason this was caught before it shipped rather than after.
  const [row] = await sql<{ id: string }[]>`
    insert into staff.round_runs
      (org_slug, round_id, walked_by, started_at, exceptions)
    values
      (${args.org}, ${args.roundId}, ${args.userId}, ${started},
       ${sql.json(args.exceptions.map((e) => ({ ...e })))})
    returning id
  `;
  return row.id;
}

/** How long the last pass took, in words, or null when it is unknown.
 *  Shown to a manager rather than to the person walking: a twelve-step
 *  lobby round attested in nine seconds is the number that matters. */
export function elapsedLabel(startedAt: string, completedAt: string): string {
  const secs = Math.max(
    0,
    Math.round(
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000
    )
  );
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}


/** The emergency guides this person's job needs.
 *
 *  Returned WITH their steps, in one pass, because the page shows every
 *  step of every guide at once. That is the opposite of the round runner
 *  and it is the correct opposite: the runner hides the next step so a
 *  walk cannot be faked from the counter, and here there is nothing to
 *  fake and everything to lose — somebody needs to see that step 4 is
 *  "call 911" before they have finished step 1. */
export async function emergencyGuides(
  sql: StaffSql,
  jobRole: string | null
): Promise<RoundDetail[]> {
  const guides = await sql<RoundSummary[]>`
    select id, key, kind, title, purpose, cadence, step_count,
           last_walked_at::text as last_walked_at,
           last_walked_by, last_exception_count
      from staff.round_board
     where kind = 'emergency'
       and staff.brief_matches(job_roles, ${jobRole}::staff.job_role)
     order by sort_order, title
  `;
  if (guides.length === 0) return [];

  // One query for every step rather than one per guide: this page is
  // opened during an incident and a dozen sequential round trips on
  // clinic wifi is the difference between a guide and a spinner.
  const ids = guides.map((g) => g.id);
  const steps = await sql<(RoundStep & { round_id: string })[]>`
    select round_id, step_no, instruction, detail
      from staff.round_steps
     where round_id = any(${ids}::uuid[])
     order by round_id, step_no
  `;

  const byRound = new Map<string, RoundStep[]>();
  for (const s of steps) {
    const list = byRound.get(s.round_id) ?? [];
    list.push({ step_no: s.step_no, instruction: s.instruction, detail: s.detail });
    byRound.set(s.round_id, list);
  }
  return guides.map((g) => ({ ...g, steps: byRound.get(g.id) ?? [] }));
}

import type { StaffSql } from "@/lib/staff/db";

// The standing rules a person works under: the directives that apply to
// their job, and the two scope-of-practice columns that say what is
// theirs to do and what is never theirs however busy the shift is.
//
// As elsewhere in this module, nothing here filters by org. RLS does
// that, and a second filter in TypeScript would be a second thing to
// keep in sync with the first.

export interface Directive {
  key: string;
  title: string;
  body: string;
  rationale: string | null;
  citation: string | null;
  critical: boolean;
  /** True when the directive has no job attached, i.e. it is everyone's. */
  everyone: boolean;
}

export interface ScopeItem {
  key: string;
  kind: "authorized" | "prohibited";
  item: string;
  /** The sanctioned alternative. Always present on a prohibited row —
   *  the database will not accept one without it. */
  instead: string | null;
  citation: string | null;
}

export interface Rules {
  directives: Directive[];
  authorized: ScopeItem[];
  prohibited: ScopeItem[];
}

/** Everything one person's job is governed by.
 *
 *  Directives use staff.brief_matches(), the same function the board
 *  uses, so a rule and a task are scoped by identical logic. Scope items
 *  do not: scope belongs to exactly one job, because the entire point of
 *  the row is that it draws a line between one job and another. Somebody
 *  with no job assigned therefore sees the universal directives and no
 *  scope at all — which is the honest answer, and the page says so
 *  rather than leaving two empty columns to be read as "no limits". */
export async function rulesFor(
  sql: StaffSql,
  jobRole: string | null
): Promise<Rules> {
  const directives = await sql<Directive[]>`
    select key, title, body, rationale, citation, critical,
           cardinality(job_roles) = 0 as everyone
      from staff.directives
     where active
       and staff.brief_matches(job_roles, ${jobRole}::staff.job_role)
     order by critical desc, sort_order, title
  `;

  const scope = jobRole
    ? await sql<ScopeItem[]>`
        select key, kind, item, instead, citation
          from staff.scope_of_practice
         where job_role = ${jobRole}::staff.job_role
         order by sort_order, item
      `
    : [];

  return {
    directives,
    authorized: scope.filter((s) => s.kind === "authorized"),
    prohibited: scope.filter((s) => s.kind === "prohibited"),
  };
}

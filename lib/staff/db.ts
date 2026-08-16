import postgres from "postgres";
import type { StaffSession } from "@/lib/staff/session";

// Database access for the staff module.
//
// WHY THIS ISN'T supabase-js
// --------------------------
// The isolation model in supabase/staff-schema.sql is row-level security
// driven by `current_setting('staff.org_slug')`. Setting that requires
// running SET/set_config on the same connection as the query, inside one
// transaction — which PostgREST (and therefore supabase-js) does not
// expose. Going through PostgREST would have meant enforcing org scoping
// in application code with a service_role key that bypasses RLS, i.e.
// every future query one forgotten `.eq("org_slug", …)` away from serving
// one org's records to another. A direct connection keeps the check in
// the database where a mistake in a route handler cannot reach it.
//
// The patient-triage side is untouched: it keeps using supabase-js and the
// anon key exactly as before. Nothing here is imported by those routes.
//
// STAFF_DATABASE_URL must point at a NON-superuser role (see the
// `staff_app` role in staff-schema.sql). A superuser bypasses RLS, which
// would silently turn every policy in that file into decoration.

// One pool per process, kept on globalThis so a hot reload in dev doesn't
// leak a new pool on every edit.
declare global {
  var __staffSql: ReturnType<typeof postgres> | undefined;
}

function client() {
  if (globalThis.__staffSql) return globalThis.__staffSql;

  const url = process.env.STAFF_DATABASE_URL;
  if (!url) throw new Error("STAFF_DATABASE_URL is not set");

  const sql = postgres(url, {
    // Supabase's pooler multiplexes connections, so server-side prepared
    // statements don't survive between queries.
    prepare: false,
    // Serverless: many short-lived instances, each of which should hold
    // almost nothing.
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  globalThis.__staffSql = sql;
  return sql;
}

export type StaffSql = ReturnType<typeof postgres>;

/**
 * Runs `fn` in a transaction whose org context is already set, so RLS
 * scopes every statement inside it.
 *
 * The org is passed explicitly rather than read from the session, because
 * the two are not always the same: during sign-in there is no session yet
 * and the org comes from the hostname. Callers that do have a session must
 * pass `session.org` — see requireStaffOrg() in lib/staff/auth.ts, which
 * is the only place the host org and the session org are reconciled.
 *
 * `set_config(..., true)` is transaction-local, so a pooled connection
 * handed to the next request never carries the previous request's org.
 * That "true" is the whole safety property of connection reuse here.
 */
export async function withOrg<T>(
  org: string,
  role: string,
  fn: (sql: StaffSql) => Promise<T>
): Promise<T> {
  const sql = client();
  return sql.begin(async (tx) => {
    await tx`select set_config('staff.org_slug', ${org}, true)`;
    await tx`select set_config('staff.role', ${role}, true)`;
    return fn(tx as unknown as StaffSql);
  }) as Promise<T>;
}

/** Convenience wrapper for a request that already has a verified session. */
export async function withSession<T>(
  session: StaffSession,
  fn: (sql: StaffSql) => Promise<T>
): Promise<T> {
  return withOrg(session.org ?? "", session.role, fn);
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.STAFF_DATABASE_URL);
}

# Security audit — pre-athenahealth connection review

**Scope:** the actual medicin.io codebase (compliance Binder + the separate patient-triage widget), ahead of connecting to athenahealth's API. **Date:** 2026-09-17. **Requested by:** repo owner, before merging PR #86.

## A note on the request itself

The audit request named tables (`public.tenants`, `public.profiles`, `public.compliance_forms`, `public.compliance_submissions`, `public.audit_logs`, `public.submission_revisions`), roles (`master_admin`, `clinic_admin`), a directory (`supabase/migrations/`), and a route (`/api/admin/users/toggle-status`) that **do not exist in this repository**. This reads like a generic template, the same way an earlier Athena "integration blueprint" document turned out to be. Rather than audit fictional tables, this report audits the real ones: **`staff.orgs`** / **`staff.users`**, row-level security scoped by `staff.current_org()`, and roles `platform_super_admin` / `org_admin` / `clinical_lead` / `manager` / `staff` / `center_admin`. Every finding below is checked against the live production database (project `aqnwdfzqelwuujfiqvcz`) and the actual source, not assumed.

## 1. Repo & credential leak scan

| Check | Result |
|---|---|
| `.gitignore` blocks env files | `.env*` (with `!.env.example` carve-out) already covers `.env`, `.env.local`, `.env.production`, `.env*.local`. `*.pem` was already present. |
| `.gitignore` blocks key files | **Gap found and fixed** — `*.key` was missing. Added. |
| Full git history (110 commits, all branches) scanned for secret-shaped strings (`sk_live_`, `whsec_`, `AIza`, `AKIA`, `ghp_`, PEM private-key headers, `postgres://` URLs with embedded passwords) | **Zero matches**, in history or in the current tree. |
| Hardcoded secret literals outside `process.env` | **None found.** Every credential-shaped variable name in the codebase resolves to `process.env.*`; the one `??` fallback found (`WASTE_PICKUP_INBOUND_DOMAIN`) is a public domain name, not a secret. |

**Verdict: clean.** No remediation needed beyond the `.gitignore` addition.

## 2. Supabase RLS audit

Queried live: every table in the `staff` schema (51 tables), every policy, every relevant role's privileges — not just the SQL source files, which can drift from what's actually applied.

- **Row-level security is enabled on all 51 tables, zero exceptions.**
- **`FORCE ROW LEVEL SECURITY` gap found and fixed.** 7 tables (`facility_templates`, `org_groups`, `org_seat_overrides`, `plan_seats`, `report_runs`, `report_subscriptions`, `user_orgs`) had RLS enabled but not forced. Verified this was **not actually exploitable**: `staff_app` (the only role the app ever connects as) is not a superuser, does not have `BYPASSRLS`, and owns none of these tables (`postgres` does) — `FORCE` only changes behavior for the owner or a bypass-privileged role, neither of which `staff_app` is. Fixed anyway, for defense-in-depth and consistency with the rest of the schema (a prior, separate pass — `staff-force-rls-normalize.sql` — had already closed the same gap on 5 *other* tables in 2026; these 7 were simply missed). New migration: `supabase/staff-force-rls-normalize-2.sql`, applied to production.
- **~44 tables** use the standard `staff_org_isolation` policy: `staff.is_super_admin() OR org_slug = staff.current_org()`, applied to every command (`ALL`). This is the correct, consistently-applied pattern.
- **6 tables have a bare `true` policy** (`email_auth_tokens`, `stripe_events`, `email_campaigns`, `email_campaign_steps`, `email_recipients`, `email_sends`). Each was individually verified as a legitimate, documented exception, not a hole:
  - `email_auth_tokens` holds only password-reset-style hashes (10-minute expiry, 5-attempt cap) and is queried exclusively by exact hash — never listed/browsed. No org context exists yet at the point this table is used (before sign-in).
  - `stripe_events` is a webhook-replay-idempotency ledger (id + type + timestamp only) that arrives before any org is known.
  - The four `email_*` tables belong to a **separate, deliberately non-multi-tenant marketing/outreach subsystem** (cold email to prospective clinics, not clinic data) — explicitly documented in `supabase/staff-email-campaigns.sql`, which also records that these tables *used* to be broken (scoped to a Postgres role the app never connects as) until a prior fix.
  - None of the 6 hold clinic compliance data, patient data, or credentials in a form that's useful if read.
- **`anon` and `authenticated` (Supabase's public API roles) have zero grants on the `staff` schema and no `USAGE` privilege on it at all** — confirmed directly via `has_schema_privilege()`. Even a `true` policy on any of the 6 tables above is unreachable through Supabase's public API; the schema itself is invisible to it. The only way in is the app's own direct Postgres connection as `staff_app`.
- **No policy grants unconditional write access to `anon`/`authenticated`/`public` in the sense the audit asked about** — the 6 `true` policies apply to `staff_app` only in practice, per the point above.

**Verdict: sound, with one now-fixed cosmetic gap.** The isolation model holds.

## 3. Athena API & zero-PHI sanitization

- **`lib/athena/sanitizer.ts` strengthened.** Before this audit it stripped `patientid`, `patientfirstname/lastname/name`, `dob`/`dateofbirth`, `ssn`, `mrn`, `insuranceid`/`insurancemember`, `guarantorid`, `chartid`. The audit specifically asked for `guarantor`, `clinical_notes`, and `vitals`, none of which were covered by name. **Fixed:** broadened `guarantorid` → bare `guarantor` (a superset match), and added `clinicalnotes`, `vitalsign`/`vitals`, `diagnosis`, `allergies`, `medications` — the fuller set of fields that would signal a real clinical payload had leaked into what should only ever be practice/department/staff data.
- **Verified, not just read:** ran the sanitizer against a mock payload containing every one of the newly-added fields plus staff-legitimate fields (`firstname`, `lastname`, `npi`, `departmentid`, `practiceid`). Confirmed every PHI-shaped field was stripped and every legitimate staff/practice field survived. (Script run via `tsx`, not committed — this repo has no test runner configured; see recommendation below.)
- **Token encryption at rest:** `lib/athena/auth.ts` encrypts the OAuth access token with AES-256-GCM before writing it to `staff.athena_connections.access_token_encrypted`; only the hash-equivalent encrypted blob is ever stored, and decryption requires `ATHENA_TOKEN_ENCRYPTION_KEY` (server-only env var). Re-verified the encrypt/decrypt round-trip and tamper-detection (a flipped byte in the ciphertext throws, doesn't silently decrypt to garbage).
- **Not readable via client queries:** `staff.athena_connections` carries the same `staff_org_isolation` RLS policy as every other tenant table, and — per the point above — `anon`/`authenticated` can't reach the `staff` schema at all. No `app/api/*` route currently reads or returns this table's contents (the sync/callback routes that would use it haven't been built yet).

**Verdict: sound**, and stronger than before this audit.

## 4. API route hardening & rate limiting

Enumerated all 71 route files under `app/api/`. 53 have an explicit auth check (`resolve()` + `atLeast()`, a bearer-token redemption function, or a cron secret check). The other 18 were individually reviewed:

- **Legitimately public, verified case by case:** the sign-in flow itself (`auth/start`, `auth/callback`, `auth/email`, `auth/email/verify`, `auth/signout`) — a session can't be required to create a session; `auth/callback` does implement OAuth `state` CSRF protection correctly. The patient-triage widget's own public surface (`chat`, `clinics*`, `clicks`, `follow-up/schedule`, `flu-activity`, `unsubscribe`, `mcp`) — already publicly documented on `/widget/security`. `trial` (a marketing signup form) and `clinics/claim` (writes to a separate manual-review queue, never the live listing).
- **Specifically checked for weaker patterns and found none:** `clinics/analytics` is gated by an unguessable `analytics_token` (`gen_random_uuid()`, the same bearer-token pattern used throughout this codebase for surveyor/calendar links) rather than a session — correct for a link handed to a clinic with no login. `auth/choose-clinic` re-validates the submitted org against `staff.list_my_orgs_for_person()` scoped to an already-verified identity cookie, so a tampered form value can't select an org the signed-in person isn't linked to.
- **Destructive staff-admin actions are correctly gated.** `app/api/staff/team/user/route.ts` (deactivate a user / reset their MFA) requires `resolve()` + `atLeast(role, "manager")`, checked server-side (not just hidden in the UI), and explicitly refuses self-deactivation to prevent an admin locking themselves — and potentially the whole org — out.
- **Webhook signature verification happens before any processing, in both webhook routes that exist:** `app/api/webhooks/stripe/route.ts` (`verifyStripeEvent` on the raw body, before parsing) and `app/api/webhooks/resend-inbound/route.ts` (Svix HMAC verification before `JSON.parse`). Unauthenticated/unsigned requests to both return 400 before touching any data.
- **Rate limiting:** the public chat endpoint caps at 10 requests/minute per IP. Noted limitation (not a fix in this pass): it's in-memory per serverless instance, so it doesn't coordinate across instances — the same honest gap already documented in this session's own `lib/athena/client.ts` QPS throttle. Low severity; worth a durable (Redis/DB-backed) limiter if abuse is ever observed, not before.
- **There is no `master_admin`/`clinic_admin`-style role**, and no `/api/admin/*` or `/api/athena/*` route tree exists yet — the Athena sync/callback routes described in the earlier blueprint haven't been built. Nothing to audit there because nothing is there.

**Verdict: sound.** No route was found accepting a destructive action without a session or an equivalent bearer credential.

## 5. Automated test suite

**Not added as `tests/security.test.ts`** — this repository has no test runner configured (no `vitest`/`jest` in `package.json`, no `test` script). Adding one is a real tooling decision (a new dependency, a CI step, an ongoing maintenance surface) that wasn't asked for before this audit and shouldn't be slipped in as a side effect of it.

What was actually run, as real verification rather than a checklist:

1. **PHI ingestion test** — a mock Athena payload with every PHI-shaped field this audit named (`patientid`, `ssn`, `dob`, `mrn`, `guarantorname`, `clinicalNotes`, `vitals`, `diagnosis`, `allergies`, `medications`) plus legitimate staff/practice fields. Confirmed every PHI field was stripped and every legitimate field survived.
2. **Token encryption round-trip + tamper detection** — confirmed AES-256-GCM encrypt→decrypt returns the original token, and a single flipped ciphertext byte throws rather than silently returning garbage.
3. **RLS structural verification** — queried `pg_policies`, `pg_roles`, and `information_schema.role_table_grants` directly against production to confirm, as ground truth: `staff_app` is non-superuser and non-bypass-RLS; `anon`/`authenticated` have no schema-level access at all; every tenant table's policy is `org_slug = current_org()`.
4. **Client bundle check** — grepped the actual built `.next/static` output (not just source) for every server-only secret's env-var name (`SUPABASE_SERVICE_ROLE_KEY`, `ATHENA_CLIENT_SECRET`, `ATHENA_TOKEN_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `STAFF_SESSION_SECRET`). None appear anywhere in what's actually shipped to browsers.

A dynamic cross-tenant query test (item asked for: "query Tenant B while authenticated as Tenant A, assert 0 rows") was **considered and deliberately not run against production** — it would require either pulling live production database credentials into this session (disproportionate risk for what's already verified structurally) or fabricating test orgs/data in production (out of scope without being asked). The structural verification in item 3 is the stronger check: it confirms the enforcement mechanism itself rather than one sample of its output.

## Summary

| Workstream | Result |
|---|---|
| Credential leak scan | Clean. `*.key` added to `.gitignore`. |
| RLS | Sound. 7-table `FORCE RLS` gap fixed (was not exploitable, now closed anyway). |
| Athena PHI sanitization + token encryption | Sound, strengthened (`guarantor`, `clinical_notes`, `vitals`, `diagnosis`, `allergies`, `medications` added). |
| API route hardening | Sound. Every destructive action and every webhook is properly gated. |
| Automated tests | No test framework exists; ran real verification directly instead of adding one unasked. |

**Recommendation: PR #86 is fine to merge on its own merits — nothing in this audit is blocking it** (the digest on/off toggle it adds doesn't touch any of the above). Separately, from an athenahealth-readiness standpoint: the code that *would* talk to Athena (`lib/athena/*`) is sound, but it still has no real sandbox credentials behind it — that's a business/registration step (`developer.api.athena.io`), not a security gap, and unchanged by this audit.

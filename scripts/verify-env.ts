/**
 * Pre-flight environment check.
 *
 *   npx tsx scripts/verify-env.ts
 *
 * WHAT IT DOES NOT DO: print a secret, or any part of one. Every check
 * reports presence, shape and length only. A verification script whose
 * output has to be treated as sensitive is one nobody can paste into a
 * ticket, which is the moment somebody stops running it.
 *
 * It also does not call any provider. Network reachability of Stripe or
 * Resend is not what fails on a Friday deploy — a key pasted with a
 * trailing newline, a test key in a production environment, or a
 * SUPABASE_SERVICE_ROLE_KEY that is actually the anon key are. Those are
 * all detectable from the value's own shape.
 *
 * EXIT CODES: 0 if every REQUIRED variable is present and well-formed,
 * 1 otherwise. Optional variables report their consequence instead of
 * failing — this product degrades honestly when one is absent, and the
 * script says which capability is off rather than pretending it is
 * broken.
 */

type Level = "required" | "optional";

interface Check {
  name: string;
  level: Level;
  /** What stops working when this is missing. */
  consequence: string;
  /** Extra validation on the value's shape. */
  shape?: (v: string) => string | null;
}

const startsWith = (p: string) => (v: string) =>
  v.startsWith(p) ? null : `expected it to start with "${p}"`;

const CHECKS: Check[] = [
  {
    name: "STAFF_DATABASE_URL",
    level: "required",
    consequence: "the whole staff module is off; pages answer 503",
    shape: (v) => {
      if (!/^postgres(ql)?:\/\//.test(v)) return "not a postgres:// URL";
      // The single most consequential misconfiguration in this product.
      // A superuser BYPASSES row-level security, so every clinic would
      // read every other clinic's records and no test would notice
      // because everything would appear to work.
      if (/:\/\/postgres[:@]/.test(v)) {
        return "points at the 'postgres' superuser — RLS is BYPASSED for superusers; use the staff_app role";
      }
      if (!/:\/\/staff_app[:@]/.test(v)) {
        return "does not use the staff_app role; confirm the role is not a superuser";
      }
      return null;
    },
  },
  {
    name: "STAFF_SESSION_SECRET",
    level: "required",
    consequence: "nobody can sign in",
    shape: (v) =>
      v.length >= 32
        ? null
        : `only ${v.length} chars; use at least 32 of randomness`,
  },
  // OPTIONAL SINCE EMAILED-CODE SIGN-IN SHIPPED. These were required
  // when Google was the only door; a deployment without them now shows
  // the six-digit-code path alone, which is the whole point of it —
  // a Microsoft 365 clinic never touches Google. Left in the list
  // because a MALFORMED value is still worth catching.
  {
    name: "GOOGLE_OAUTH_CLIENT_ID",
    level: "optional",
    consequence: "no Google button; emailed-code sign-in still works",
    shape: (v) =>
      v.endsWith(".apps.googleusercontent.com")
        ? null
        : "does not look like a Google client id",
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_SECRET",
    level: "optional",
    consequence: "Google sign-in fails at the callback; emailed code unaffected",
  },
  {
    // THE FIX FOR GOOGLE SIGN-IN ON A PREVIEW URL. callbackUrl() in
    // lib/staff/google.ts derives redirect_uri from the request host,
    // so on a *.vercel.app preview it sends a URI that is not — and
    // cannot practically be — registered in Google Cloud, since the
    // hostname changes per branch. Google answers redirect_uri_mismatch
    // and the button looks broken. Setting this pins the redirect to the
    // one registered origin. Undocumented until now, which is why the
    // symptom kept reading as "Google isn't set up".
    name: "STAFF_OAUTH_REDIRECT_ORIGIN",
    level: "optional",
    consequence:
      "Google sign-in on preview/non-canonical hosts fails with redirect_uri_mismatch",
    shape: (v) =>
      /^https?:\/\/[^/]+$/.test(v)
        ? null
        : "expected a bare origin with no trailing path, e.g. https://medicin.io",
  },

  {
    name: "STRIPE_SECRET_KEY",
    level: "optional",
    consequence: "no checkout; trials and billing are inert",
    shape: (v) => {
      if (!/^sk_(test|live)_/.test(v)) return "expected sk_test_ or sk_live_";
      if (process.env.VERCEL_ENV === "production" && v.startsWith("sk_test_")) {
        return "TEST key in a production environment";
      }
      return null;
    },
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    level: "optional",
    consequence:
      "subscription changes never reach the app; a lapsed card never flips is_read_only",
    shape: startsWith("whsec_"),
  },
  {
    name: "STRIPE_PAYMENT_LINK",
    level: "optional",
    consequence:
      "a read-only clinic is told to sort out billing with nothing to click",
    // Only Stripe's own hosted domains. This is a link an administrator
    // is asked to put a card into, so anything else must fail here
    // rather than in front of a customer.
    shape: (v) => {
      let url: URL;
      try {
        url = new URL(v);
      } catch {
        return "not a URL";
      }
      if (url.protocol !== "https:") return "must be https";
      const host = url.hostname.toLowerCase();
      return host === "buy.stripe.com" || host.endsWith(".stripe.com")
        ? null
        : "expected a Stripe-hosted link (buy.stripe.com)";
    },
  },

  {
    name: "ALERT_FROM_EMAIL",
    level: "optional",
    consequence: "alerts queue but never send",
    shape: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : "not an email address"),
  },
  { name: "RESEND_API_KEY", level: "optional", consequence: "one of the mail providers", shape: startsWith("re_") },
  { name: "POSTMARK_SERVER_TOKEN", level: "optional", consequence: "one of the mail providers" },
  { name: "SENDGRID_API_KEY", level: "optional", consequence: "one of the mail providers", shape: startsWith("SG.") },

  { name: "TWILIO_ACCOUNT_SID", level: "optional", consequence: "no excursion SMS", shape: startsWith("AC") },
  { name: "TWILIO_AUTH_TOKEN", level: "optional", consequence: "no excursion SMS" },
  {
    name: "TWILIO_FROM_NUMBER",
    level: "optional",
    consequence: "no excursion SMS",
    shape: (v) => (/^\+[1-9]\d{7,14}$/.test(v) ? null : "not E.164, e.g. +12155551234"),
  },

  {
    name: "CRON_SECRET",
    level: "optional",
    consequence: "the alert sweep cannot be triggered by hand (Vercel Cron still works)",
    shape: (v) => (v.length >= 16 ? null : "too short to be worth having"),
  },

  { name: "NEXT_PUBLIC_SUPABASE_URL", level: "optional", consequence: "no file uploads; documents record dates only", shape: startsWith("https://") },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    level: "optional",
    consequence: "no file uploads; documents record dates only",
    shape: (v) => {
      // A JWT's middle segment carries the role. Pasting the anon key
      // here produces uploads that fail with a permission error hours
      // later, which is a bad way to find out.
      try {
        const claims = JSON.parse(
          Buffer.from(v.split(".")[1] ?? "", "base64").toString("utf8")
        );
        if (claims.role && claims.role !== "service_role") {
          return `this is the "${claims.role}" key, not the service_role key`;
        }
      } catch {
        return "not a readable JWT";
      }
      return null;
    },
  },
];

// Groups where at least one member must be present for the capability to
// work at all. Reported once, rather than as three separate absences.
const EITHER_OR: { label: string; any: string[]; consequence: string }[] = [
  {
    label: "a mail provider",
    any: ["RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SENDGRID_API_KEY"],
    consequence: "alerts queue durably but are never delivered",
  },
];

function main(): void {
  let failed = 0;
  const notes: string[] = [];

  console.log("\n  medicin. — environment check\n");

  for (const c of CHECKS) {
    const raw = process.env[c.name];
    const v = raw?.trim() ?? "";

    if (!raw) {
      if (c.level === "required") {
        failed += 1;
        console.log(`  FAIL  ${c.name} — missing. ${c.consequence}.`);
      } else {
        notes.push(`  off   ${c.name} — not set: ${c.consequence}.`);
      }
      continue;
    }

    // Caught here because it is invisible everywhere else: a trailing
    // newline from a copy-paste turns a valid key into a 401 that looks
    // like a wrong key.
    if (raw !== v) {
      failed += c.level === "required" ? 1 : 0;
      console.log(`  ${c.level === "required" ? "FAIL" : "WARN"}  ${c.name} — has leading or trailing whitespace.`);
      continue;
    }

    const problem = c.shape?.(v) ?? null;
    if (problem) {
      failed += c.level === "required" ? 1 : 0;
      console.log(`  ${c.level === "required" ? "FAIL" : "WARN"}  ${c.name} — ${problem}.`);
      continue;
    }

    console.log(`  ok    ${c.name} (${v.length} chars)`);
  }

  for (const g of EITHER_OR) {
    if (!g.any.some((n) => process.env[n])) {
      notes.push(`  off   ${g.label} — none of ${g.any.join(", ")} set: ${g.consequence}.`);
    }
  }

  if (notes.length > 0) {
    console.log("\n  Capabilities currently off (not errors):\n");
    for (const n of notes) console.log(n);
  }

  console.log(
    failed === 0
      ? "\n  All required variables present.\n"
      : `\n  ${failed} required ${failed === 1 ? "variable" : "variables"} missing or malformed.\n`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();

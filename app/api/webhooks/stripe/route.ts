import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/staff/db";
import { verifyStripeEvent, idOf, slugFrom } from "@/lib/staff/stripe";

// POST /api/webhooks/stripe
//
// The only way a clinic's subscription state changes. Nothing else writes
// is_read_only, so there is one path in and it is signed.
//
// THE RULE THIS HANDLER EXISTS TO ENFORCE: non-payment is read-only, never
// lockout. Every record a clinic has already made stays readable and
// exportable forever. Only new operational entries stop. Their compliance
// records are the evidence they show a surveyor, and holding that hostage
// over a failed card would make this product the cause of the exact
// catastrophe it is sold to prevent.

export const runtime = "nodejs";

// Which Stripe events mean what. Anything not listed is acknowledged and
// ignored — Stripe sends a lot, and 200-ing the rest stops it retrying
// events we were never going to act on.
const ACTIVATE = new Set([
  "checkout.session.completed",
  "invoice.payment_succeeded",
]);
const SUSPEND = new Set([
  "invoice.payment_failed",
  "customer.subscription.deleted",
  "customer.subscription.paused",
]);

export async function POST(req: NextRequest) {
  // Raw text, before any parsing. See verifyStripeEvent for why.
  const raw = await req.text();

  const verified = await verifyStripeEvent(
    raw,
    req.headers.get("stripe-signature"),
    process.env.STRIPE_WEBHOOK_SECRET
  );
  if (!verified.ok) {
    console.error("[stripe] rejected webhook:", verified.reason);
    // 400 so Stripe surfaces it in the dashboard rather than retrying
    // something that will never verify.
    return NextResponse.json({ error: verified.reason }, { status: 400 });
  }

  const event = verified.event;
  const obj = event.data.object;

  try {
    const handled = await withOrg("", "platform_super_admin", async (sql) => {
      // Replay guard first. A retry after a partial failure would
      // otherwise re-run whatever the first attempt managed.
      const fresh = await sql<{ id: string }[]>`
        insert into staff.stripe_events (id, type)
        values (${event.id}, ${event.type})
        on conflict (id) do nothing
        returning id
      `;
      if (fresh.length === 0) return { skipped: "already_processed" as const };

      const customer = idOf(obj.customer);
      if (!customer) return { skipped: "no_customer" as const };

      const subscription = idOf(obj.subscription) ?? obj.id ?? null;
      const email =
        obj.customer_details?.email ?? obj.customer_email ?? null;

      // Which org? A Payment Link can carry the slug in
      // client_reference_id for an existing clinic adding a location or
      // reactivating. Otherwise this is a new customer and we provision.
      // Three accepted keys because a Payment Link can be configured any
      // of these ways and getting it wrong silently provisions a second
      // org instead of updating the intended one.
      const claimed =
        obj.client_reference_id ??
        obj.metadata?.org_slug ??
        obj.metadata?.org_id ??
        null;

      let slug: string | null = null;
      const byCustomer = await sql<{ slug: string }[]>`
        select slug from staff.orgs where stripe_customer_id = ${customer}
      `;
      if (byCustomer.length > 0) slug = byCustomer[0].slug;

      if (!slug && claimed) {
        const byClaim = await sql<{ slug: string }[]>`
          select slug from staff.orgs where slug = ${claimed}
        `;
        if (byClaim.length > 0) {
          slug = byClaim[0].slug;
          await sql`
            update staff.orgs
               set stripe_customer_id = ${customer},
                   stripe_subscription_id = ${subscription},
                   billing_email = coalesce(${email}, billing_email)
             where slug = ${slug}
          `;
        }
      }

      if (!slug) {
        // A new clinic, only ever from a completed checkout. A failed
        // payment for a customer we have never seen is not a reason to
        // create an org.
        if (event.type !== "checkout.session.completed" || !email) {
          return { skipped: "unknown_customer" as const };
        }
        slug = await sql<{ provision_org: string }[]>`
          select staff.provision_org(
            ${slugFrom(obj.customer_details?.name ?? null, email)},
            ${obj.customer_details?.name ?? email.split("@")[0]},
            ${customer}, ${subscription}, ${email}
          )
        `.then((r) => r[0].provision_org);
        return { provisioned: slug };
      }

      if (ACTIVATE.has(event.type)) {
        await sql`
          update staff.orgs
             set subscription_status = 'active',
                 is_read_only = false,
                 read_only_since = null,
                 stripe_subscription_id = coalesce(${subscription}, stripe_subscription_id)
           where slug = ${slug}
        `;
        return { org: slug, state: "active" as const };
      }

      if (SUSPEND.has(event.type)) {
        await sql`
          update staff.orgs
             set subscription_status = ${event.type === "invoice.payment_failed" ? "past_due" : "canceled"},
                 is_read_only = true,
                 read_only_since = coalesce(read_only_since, now())
           where slug = ${slug}
        `;
        return { org: slug, state: "read_only" as const };
      }

      // customer.subscription.updated carries the authoritative status, so
      // it is read from the object rather than inferred from the event
      // name — a subscription can go past_due and recover without any
      // other event firing.
      if (event.type === "customer.subscription.updated" && obj.status) {
        const healthy = obj.status === "active" || obj.status === "trialing";
        // now() has to be SQL, not a parameter. Passing the string
        // "now()" and casting it threw — 'now()' is not a valid timestamp
        // literal ('now' would be) — so every past_due webhook 500'd
        // while the active path worked, which is the failure mode that
        // silently lets a lapsed clinic keep filing.
        await sql`
          update staff.orgs
             set subscription_status = ${obj.status},
                 is_read_only = ${!healthy},
                 read_only_since = case when ${healthy}
                                        then null
                                        else coalesce(read_only_since, now())
                                   end,
                 stripe_subscription_id = coalesce(${subscription}, stripe_subscription_id)
           where slug = ${slug}
        `;
        return { org: slug, state: healthy ? ("active" as const) : ("read_only" as const) };
      }

      return { skipped: "unhandled_type" as const };
    });

    if ("org" in handled || "provisioned" in handled) {
      console.log("[stripe]", event.type, JSON.stringify(handled));
    }
    return NextResponse.json({ received: true, ...handled });
  } catch (err) {
    console.error(
      "[stripe] handler failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    // 500 so Stripe retries. The replay guard makes that safe.
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

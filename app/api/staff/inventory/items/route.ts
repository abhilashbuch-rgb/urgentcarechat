import { NextRequest } from "next/server";
import { resolve } from "@/lib/staff/auth";
import { withSession } from "@/lib/staff/db";
import { getProfile } from "@/lib/staff/compliance";
import { runsClinic } from "@/lib/staff/roles";
import { redirectAfterPost } from "@/lib/staff/http";
import { addonEnabled, createItem, setItemActive } from "@/lib/staff/inventory";

// POST /api/staff/inventory/items — the catalog itself: add an item,
// deactivate one, bring one back.
//
// Owner by ROLE or centre admin by JOB — see runsClinic(). Same
// reasoning as app/api/staff/settings/logs/route.ts: the person who
// knows what's actually on the shelf is very often a plain "staff"
// account.
//
// A plain form POST, same as the rest of the admin screens — it has to
// work on a phone in the stock room, and the navigation is the feedback.

export const runtime = "nodejs";

const MAX_NAME = 120;
const MAX_UNIT = 40;
const MAX_CATEGORY = 60;

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) return redirectAfterPost(`/staff/signin?e=${auth.reason}`);
  const { session, org } = auth.ctx;

  const form = await req.formData();
  const action = String(form.get("action") ?? "");

  try {
    const allowed = await withSession(session, async (sql) => {
      const me = await getProfile(sql, session.uid);
      if (!runsClinic(session.role, me?.job_role ?? null)) return false;
      if (!(await addonEnabled(sql, org))) return false;

      if (action === "create") {
        const name = String(form.get("name") ?? "").trim().slice(0, MAX_NAME);
        if (!name) return "bad_name";
        const category =
          String(form.get("category") ?? "").trim().slice(0, MAX_CATEGORY) || null;
        const unit =
          String(form.get("unit") ?? "each").trim().slice(0, MAX_UNIT) || "each";
        const thresholdRaw = String(form.get("reorder_threshold") ?? "").trim();
        const threshold = thresholdRaw ? Number(thresholdRaw) : null;
        if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) {
          return "bad_threshold";
        }
        await createItem(sql, org, session.uid, name, category, unit, threshold);
        return true;
      }

      if (action === "deactivate" || action === "reactivate") {
        const itemId = String(form.get("item_id") ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(itemId)) return "bad_item";
        await setItemActive(sql, org, itemId, action === "reactivate");
        return true;
      }

      return "bad_action";
    });

    if (allowed !== true) {
      return redirectAfterPost(
        `/staff/inventory?e=${allowed === false ? "forbidden" : allowed}`
      );
    }
  } catch (err) {
    console.error(
      "[inventory-items] save failed for org",
      org,
      err instanceof Error ? err.message : err
    );
    return redirectAfterPost("/staff/inventory?e=save");
  }

  return redirectAfterPost("/staff/inventory?saved=1");
}

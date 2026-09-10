import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { resolve } from "@/lib/staff/auth";

// POST /api/staff/logs/read-digits — read a digital display from a
// cropped photo. Returns a candidate number, never saves anything.
//
// THIS ROUTE HAS NO WRITE PATH. No DB insert, no storage upload — the
// image it's handed is used for exactly one Anthropic call and then
// forgotten. The actual record of what a reading was is made entirely
// by the normal /api/staff/logs/submit path, exactly as if the number
// had been typed; this route only ever proposes what to type.
//
// ONLY EVER A TIGHT CROP OF A DISPLAY, NEVER A FULL FRAME. The client
// (AiPhotoRead.tsx / PhotoCrop.tsx) crops before this route ever sees
// anything. See supabase/staff-log-photos.sql for why that boundary
// matters here specifically — this product already declined to send
// full staff photographs to a third-party vision API for a different
// reason, and this route is deliberately scoped narrower than that.
//
// LOW CONFIDENCE AND A PARSE FAILURE LOOK IDENTICAL TO THE CLIENT: both
// come back as value: null. There is no shaky-guess state to render by
// mistake — the client only ever has to branch on whether value is a
// number.

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024; // a cropped display should be tiny
const ALLOWED = new Set(["image/jpeg", "image/png"]);
const MODEL = "claude-haiku-4-5-20251001";

const PROMPT = `You are reading a photo of a digital thermometer or freezer display. Respond with ONLY a JSON object, no other text, no markdown fences:

{"value": <number or null>, "confidence": "high" or "low", "raw_text": "<verbatim digits you see>"}

Rules:
- "value" is the numeric temperature reading, or null if you cannot determine one.
- Use "confidence": "low" (and value: null) whenever the display is blank, off, obscured, showing an error code, ambiguous, or this is not a digital numeric readout at all.
- Only use "confidence": "high" when the digits are clearly legible and unambiguous.
- Do not guess. A missed reading is far better than a wrong one.`;

// Per-user, not per-IP — clinic staff share wifi/IP, and this is behind
// auth already, so the point is capping spend per person, not blocking
// anonymous traffic.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60_000);

interface VisionResult {
  value: number | null;
  confidence: "high" | "low";
}

/** Never lets a malformed or borderline model response reach the client
 *  as anything other than null — see the file header. */
function parseVisionResponse(text: string): VisionResult {
  try {
    const stripped = text.replace(/```(?:json)?/g, "").trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    const value = typeof parsed.value === "number" && Number.isFinite(parsed.value) ? parsed.value : null;
    const confidence = parsed.confidence === "high" ? "high" : "low";
    if (value === null || confidence !== "high") return { value: null, confidence: "low" };
    return { value, confidence: "high" };
  } catch {
    return { value: null, confidence: "low" };
  }
}

export async function POST(req: NextRequest) {
  const auth = await resolve();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }
  const { session } = auth.ctx;

  if (!checkRateLimit(session.uid)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[read-digits] ANTHROPIC_API_KEY not configured");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "bad_form" }, { status: 400 });

  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "no_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ ok: false, error: "bad_file_type" }, { status: 415 });
  }

  const start = Date.now();
  try {
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: file.type as "image/jpeg" | "image/png",
                data: base64,
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const result = parseVisionResponse(textBlock?.text ?? "");

    // Metadata only — never the image, never raw_text, never the value.
    console.log(
      `[read-digits] confidence=${result.confidence} latency_ms=${Date.now() - start} ` +
        `tokens_in=${response.usage.input_tokens} tokens_out=${response.usage.output_tokens}`
    );

    return NextResponse.json({ ok: true, value: result.value, confidence: result.confidence, model: MODEL });
  } catch (err) {
    console.error("[read-digits] vision call failed:", err instanceof Error ? err.message : "Unknown");
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 502 });
  }
}

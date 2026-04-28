import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";

// ============================================================
// /api/chat — LLM triage endpoint
// Wraps Anthropic Claude with the system prompt from SYSTEM_PROMPT.md.
// Never logs message contents. Rate-limited per IP.
// ============================================================

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Simple in-memory rate limiter: 10 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60_000);

export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429 }
      );
    }

    // Validate API key is configured
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY not configured");
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      );
    }

    // Parse request
    const body = await req.json();
    const messages: ChatMessage[] = body.messages;

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }

    // Limit conversation length to prevent abuse (max 30 turns)
    const trimmedMessages = messages.slice(-30);

    // Call Anthropic Claude
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: trimmedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    // Extract text from response
    const textBlock = response.content.find((block) => block.type === "text");
    const content = textBlock ? textBlock.text : "I'm sorry, I couldn't process that. Could you try again?";

    // Check if the LLM triggered a clinic search via the [SEARCH_CLINICS] tag
    const searchMatch = content.match(
      /\[SEARCH_CLINICS\s+zip=(\d{5})\s+insurance=(\w+)\]/
    );

    let clinicSearchParams = null;
    let cleanContent = content;

    if (searchMatch) {
      clinicSearchParams = {
        zip: searchMatch[1],
        insurance: searchMatch[2] === "none" ? null : searchMatch[2],
      };
      // Remove the search tag from the displayed text
      cleanContent = content
        .replace(/\[SEARCH_CLINICS\s+zip=\d{5}\s+insurance=\w+\]/, "")
        .trim();
    }

    // Log only metadata, never content
    console.log(
      `[chat] turns=${trimmedMessages.length} tokens_in=${response.usage.input_tokens} tokens_out=${response.usage.output_tokens}`
    );

    return NextResponse.json({
      content: cleanContent,
      clinicSearch: clinicSearchParams,
    });
  } catch (err: unknown) {
    console.error("Chat API error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json(
      { error: "Something went wrong. If this is an emergency, please call 911." },
      { status: 500 }
    );
  }
}

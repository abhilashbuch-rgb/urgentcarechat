import { NextRequest, NextResponse } from "next/server";

// ============================================================
// /api/chat — LLM triage endpoint
// Phase 3 will wire this to the Anthropic API with the system prompt.
// For now, returns a mock response so the frontend works end-to-end.
// ============================================================

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: ChatMessage[] = body.messages;

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided" },
        { status: 400 }
      );
    }

    const lastMessage = messages[messages.length - 1].content.toLowerCase();

    // STUB: Simple state-machine mock until Anthropic API is wired up
    // This mimics the original prototype behavior.
    let content: string;

    if (messages.length === 1) {
      content =
        "Got it — that sounds uncomfortable. How long has this been going on?";
    } else if (messages.length === 3) {
      content =
        "Okay. What's your zip code so I can find clinics near you?";
    } else if (messages.length === 5) {
      if (/^\d{5}$/.test(lastMessage)) {
        content =
          "Want to filter by insurance? You can say Aetna, BCBS, Cigna, United, Medicare, or just say skip.";
      } else {
        content =
          "That doesn't look like a zip code — could you share a 5-digit zip?";
      }
    } else if (messages.length === 7) {
      content =
        "Searching for urgent care clinics near you...";
      // In Phase 4, this is where we'd trigger the clinic search
    } else {
      content =
        "Anything else I can help with? You can describe a new symptom or search a different zip.";
    }

    return NextResponse.json({ content, clinics: null });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

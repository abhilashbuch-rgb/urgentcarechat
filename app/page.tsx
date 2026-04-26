"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ============================================================
// Types
// ============================================================
interface Clinic {
  name: string;
  distance: string;
  address: string;
  phone: string;
  open: boolean;
  hours: string;
  services: string[];
  insurance: string[];
  rating: number;
  featured: boolean;
  directionsUrl: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface UIMessage {
  id: number;
  type: "bot" | "user" | "alert-911" | "alert-988" | "clinics" | "typing";
  text?: string;
  html?: string;
  quickReplies?: string[];
  alertTitle?: string;
  alertBody?: string;
  alertCta?: string;
  alertHref?: string;
  clinics?: Clinic[];
}

// ============================================================
// Red-flag detection (client-side defense-in-depth)
// Mirrors the system prompt — server-side LLM also enforces these.
// ============================================================
const RED_FLAGS_911 = [
  /chest pain|chest pressure|crushing chest|tight chest/i,
  /can'?t breathe|cannot breathe|trouble breathing|short(ness)? of breath|gasping/i,
  /face drooping|one[- ]sided weakness|slurred speech|sudden confusion/i,
  /severe (head|abdominal) (injury|pain)/i,
  /severe (allergic|bleeding)|anaphylaxis|throat swelling|can'?t swallow/i,
  /coughing up blood|vomiting blood/i,
  /unresponsive|seizure|overdose/i,
  /pregnan(t|cy).*(bleeding|severe pain)/i,
];

const RED_FLAGS_988 = [
  /kill myself|suicid(e|al)|end my life|want to die|hurt myself|self.?harm/i,
];

const RED_FLAGS_PED = [
  /(baby|infant|newborn|month old|weeks old).*fever/i,
  /fever.*(baby|infant|newborn|month old|weeks old)/i,
];

function checkRedFlags(text: string): "911" | "988" | "pediatric" | null {
  if (RED_FLAGS_988.some((r) => r.test(text))) return "988";
  if (RED_FLAGS_911.some((r) => r.test(text))) return "911";
  if (RED_FLAGS_PED.some((r) => r.test(text))) return "pediatric";
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================
// Main Chat Component
// ============================================================
export default function Home() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>(
    []
  );
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  const addMessage = useCallback((msg: Omit<UIMessage, "id">) => {
    const id = nextId.current++;
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  }, []);

  const removeMessage = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }, 50);
  }, [messages]);

  // Opening message
  useEffect(() => {
    const timer = setTimeout(() => {
      addMessage({
        type: "bot",
        text: "Hi \u2014 I'm an AI assistant, not a doctor. If this is a life-threatening emergency, please call 911 right now.\n\nOtherwise, tell me what's going on and I'll help you find a nearby urgent care.",
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [addMessage]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Log clinic clicks for analytics
  const logClick = async (clinicName: string, action: string) => {
    try {
      await fetch("/api/clicks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicName,
          action,
          sessionId:
            sessionStorage.getItem("uc_session") ||
            (() => {
              const id = crypto.randomUUID();
              sessionStorage.setItem("uc_session", id);
              return id;
            })(),
        }),
      });
    } catch {
      // Analytics failure should never block the user
    }
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText || inputValue).trim();
    if (!text || isLoading) return;

    setInputValue("");
    setIsLoading(true);

    // Show user message
    addMessage({ type: "user", text });

    // Client-side red flag check (defense-in-depth)
    const redFlag = checkRedFlags(text);
    if (redFlag) {
      const typingId = addMessage({ type: "typing" });
      await new Promise((r) => setTimeout(r, 800));
      removeMessage(typingId);

      if (redFlag === "911") {
        addMessage({
          type: "alert-911",
          alertTitle: "This may be a medical emergency.",
          alertBody:
            "What you described could be serious. Please call 911 right now or have someone drive you to the nearest ER. Don't wait \u2014 urgent care is not the right place for this.",
          alertCta: "Call 911",
          alertHref: "tel:911",
        });
      } else if (redFlag === "988") {
        addMessage({
          type: "alert-988",
          alertTitle: "I want you to be safe.",
          alertBody:
            "Please reach out to the 988 Suicide & Crisis Lifeline \u2014 call or text 988. They're free, confidential, and available 24/7. You don't have to handle this alone.",
          alertCta: "Call or text 988",
          alertHref: "tel:988",
        });
      } else if (redFlag === "pediatric") {
        addMessage({
          type: "alert-911",
          alertTitle: "For a young child, this needs ER-level care.",
          alertBody:
            "For an infant or young child with these symptoms, please call 911 or go to a pediatric emergency room \u2014 not urgent care.",
          alertCta: "Call 911",
          alertHref: "tel:911",
        });
      }

      setIsLoading(false);
      inputRef.current?.focus();
      return;
    }

    // Show typing indicator
    const typingId = addMessage({ type: "typing" });

    // Build conversation history for the API
    const newHistory: ChatMessage[] = [
      ...conversationHistory,
      { role: "user", content: text },
    ];

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHistory }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();
      const assistantText: string = data.content;

      // Update conversation history
      const updatedHistory: ChatMessage[] = [
        ...newHistory,
        { role: "assistant", content: assistantText },
      ];
      setConversationHistory(updatedHistory);

      removeMessage(typingId);

      // Check if the LLM response mentions 911 or 988 (server-side red flag)
      if (/call 911/i.test(assistantText) && /emergency/i.test(assistantText)) {
        addMessage({
          type: "alert-911",
          alertTitle: "This may be a medical emergency.",
          alertBody: assistantText,
          alertCta: "Call 911",
          alertHref: "tel:911",
        });
      } else if (/988/i.test(assistantText) && /suicid|crisis|safe/i.test(assistantText)) {
        addMessage({
          type: "alert-988",
          alertTitle: "I want you to be safe.",
          alertBody: assistantText,
          alertCta: "Call or text 988",
          alertHref: "tel:988",
        });
      } else {
        addMessage({ type: "bot", text: assistantText });
      }

      // Check if the assistant is asking for a zip code or just gave one
      // If the response contains clinic results, render them
      if (data.clinics && data.clinics.length > 0) {
        addMessage({ type: "clinics", clinics: data.clinics });
      }
    } catch (err) {
      removeMessage(typingId);
      console.error("Chat error:", err);
      addMessage({
        type: "bot",
        text: "Sorry, I'm having trouble connecting right now. If this is an emergency, please call 911. Otherwise, try again in a moment.",
      });
    }

    setIsLoading(false);
    inputRef.current?.focus();
  };

  return (
    <>
      <header className="site-header">
        <div className="brand">
          <span className="dot"></span>urgentcare<span className="tld">.chat</span>
        </div>
        <div className="tagline">Care, nearby. Right now.</div>
      </header>

      <main className="app">
        <div className="disclaimer">
          <strong>Not a doctor.</strong> If this is a life-threatening emergency,
          call <strong>911</strong> immediately. For mental health crisis, call or
          text <strong>988</strong>.
        </div>

        <div className="chat" ref={chatRef}>
          {messages.map((msg) => {
            if (msg.type === "typing") {
              return (
                <div key={msg.id} className="msg bot">
                  <div className="msg-label">Assistant</div>
                  <div className="msg-bubble">
                    <div className="typing">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              );
            }

            if (msg.type === "user") {
              return (
                <div key={msg.id} className="msg user">
                  <div className="msg-label">You</div>
                  <div className="msg-bubble">{msg.text}</div>
                </div>
              );
            }

            if (msg.type === "alert-911" || msg.type === "alert-988") {
              const cssClass =
                msg.type === "alert-988" ? "alert-988" : "alert-911";
              return (
                <div key={msg.id} className="msg bot">
                  <div className="msg-label">Assistant</div>
                  <div className={cssClass}>
                    <div className="alert-title">{msg.alertTitle}</div>
                    <div>{msg.alertBody}</div>
                    <a className="alert-cta" href={msg.alertHref}>
                      {msg.alertCta}
                    </a>
                  </div>
                </div>
              );
            }

            if (msg.type === "clinics" && msg.clinics) {
              return (
                <div key={msg.id} className="msg bot">
                  <div className="msg-label">Assistant</div>
                  <div className="msg-bubble">
                    Here are the closest options:
                  </div>
                  <div className="clinic-list">
                    {msg.clinics.map((c, i) => (
                      <div
                        key={i}
                        className={`clinic-card${c.featured ? " featured" : ""}`}
                      >
                        {c.featured && (
                          <span className="featured-tag">Featured</span>
                        )}
                        <div className="clinic-name">{c.name}</div>
                        <div className="clinic-meta">
                          <span>{c.distance}</span>
                          <span>&middot;</span>
                          <span className={c.open ? "open" : "closed"}>
                            {c.hours}
                          </span>
                          <span>&middot;</span>
                          <span>&#9733; {c.rating}</span>
                        </div>
                        <div className="clinic-tags">
                          {c.services.map((s) => (
                            <span key={s} className="tag">
                              {s}
                            </span>
                          ))}
                          {c.insurance.map((ins) => (
                            <span key={ins} className="tag insurance">
                              {ins}
                            </span>
                          ))}
                        </div>
                        <div className="clinic-actions">
                          <a
                            className="clinic-btn"
                            href={c.directionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() =>
                              logClick(c.name, "directions")
                            }
                          >
                            Directions
                          </a>
                          <a
                            className="clinic-btn secondary"
                            href={`tel:${c.phone.replace(/\D/g, "")}`}
                            onClick={() => logClick(c.name, "call")}
                          >
                            Call {c.phone}
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            // Default: bot message
            return (
              <div key={msg.id} className="msg bot">
                <div className="msg-label">Assistant</div>
                <div className="msg-bubble">
                  {msg.text?.split("\n").map((line, i) => (
                    <span key={i}>
                      {line}
                      {i < (msg.text?.split("\n").length ?? 1) - 1 && <br />}
                    </span>
                  ))}
                </div>
                {msg.quickReplies && (
                  <div className="quick-replies">
                    {msg.quickReplies.map((label) => (
                      <button
                        key={label}
                        className="quick-reply"
                        onClick={() => handleSend(label)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      <div className="input-bar">
        <div className="input-wrap">
          <input
            ref={inputRef}
            type="text"
            id="input"
            placeholder="What's going on?"
            autoComplete="off"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            disabled={isLoading}
          />
          <button
            id="send-btn"
            onClick={() => handleSend()}
            disabled={isLoading || !inputValue.trim()}
          >
            Send
          </button>
        </div>
        <div className="footer-note">
          NOT A SUBSTITUTE FOR MEDICAL ADVICE &middot; NO PHI STORED
        </div>
      </div>
    </>
  );
}

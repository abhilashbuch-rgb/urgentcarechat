"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { STRINGS, getStoredLanguage, type Language } from "@/lib/i18n";
import FollowUpOptIn from "./components/FollowUpOptIn";
import ClaimListing from "./components/ClaimListing";
import { checkRedFlags } from "@/lib/red-flags";

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
  directionsUrl: string;
  websiteUrl: string;
  placeId?: string;
  featured?: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type CareLevel = "emergency" | "urgent" | "self_care";

interface UIMessage {
  id: number;
  type: "bot" | "user" | "alert-911" | "alert-988" | "clinics" | "typing";
  text?: string;
  quickReplies?: string[];
  alertTitle?: string;
  alertBody?: string;
  alertCta?: string;
  alertHref?: string;
  alertAriaLabel?: string;
  alertNote?: string;
  alertTextCta?: string;
  alertTextHref?: string;
  alertTextAriaLabel?: string;
  clinics?: Clinic[];
  careLevel?: CareLevel;
}

// ============================================================
// Red-flag detection (client-side defense-in-depth)
// Fires BEFORE the API call to catch obvious cases instantly.
// The server-side LLM also enforces these via the system prompt.
// Shared with the telehealth intake screen — see lib/red-flags.ts.
// ============================================================

// ============================================================
// Session ID for analytics (anonymous, random per browser session)
// ============================================================
function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = sessionStorage.getItem("uc_session");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("uc_session", id);
  }
  return id;
}

// ============================================================
// Main Chat Component
// `embed` renders a chrome-less version for the /widget iframe:
// no site header, no doctor CTA banner, just the chat itself.
// ============================================================
export default function Home({ embed = false }: { embed?: boolean }) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>(
    []
  );
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [patientContext, setPatientContext] = useState<
    "self" | "child" | "other" | null
  >(null);
  const [language, setLanguage] = useState<Language>("en");
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const t = STRINGS[language];

  const toggleLanguage = () => {
    const next: Language = language === "en" ? "es" : "en";
    setLanguage(next);
    localStorage.setItem("uc_lang", next);
  };

  // Show the full disclaimer modal once per browser session
  useEffect(() => {
    const timer = setTimeout(() => {
      const ack = sessionStorage.getItem("uc_disclaimer_ack");
      if (!ack) setShowDisclaimer(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const acknowledgeDisclaimer = () => {
    sessionStorage.setItem("uc_disclaimer_ack", "1");
    setShowDisclaimer(false);
    inputRef.current?.focus();
  };

  const addMessage = useCallback((msg: Omit<UIMessage, "id">): number => {
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

  // Opening message \u2014 restores the saved language preference (if any) and
  // asks who this is for first, so pediatric triage can be sharper from
  // the very first symptom question.
  useEffect(() => {
    const timer = setTimeout(() => {
      const lang = getStoredLanguage();
      setLanguage(lang);
      const strings = STRINGS[lang];
      addMessage({
        type: "bot",
        text: strings.openingWhoFor,
        quickReplies: [strings.whoForMyself, strings.whoForChild, strings.whoForOther],
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [addMessage]);

  const showSymptomPrompt = useCallback(() => {
    addMessage({
      type: "bot",
      text: t.symptomPrompt,
      quickReplies: [t.qrFindClinics, t.qrSymptomQuestion],
    });
  }, [addMessage, t]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The hero recedes as soon as the visitor actually engages, so it
  // reads as a warm intro rather than something permanently in the way.
  const hasStarted = messages.some((m) => m.type === "user");

  // Once a 911/988 alert has shown, keep the footer free of anything
  // but the essentials for the rest of the session.
  const hasEmergencyAlert = messages.some(
    (m) => m.type === "alert-911" || m.type === "alert-988"
  );

  // Log clinic clicks for analytics
  const logClick = async (clinicName: string, action: string) => {
    try {
      await fetch("/api/clicks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicName,
          action,
          sessionId: getSessionId(),
        }),
      });
    } catch {
      // Analytics failure should never block the user
    }
  };

  // Fetch clinics from the real API
  const fetchClinics = async (
    zip: string,
    insurance: string | null
  ): Promise<Clinic[]> => {
    const params = new URLSearchParams({ zip });
    if (insurance) params.set("insurance", insurance);

    const res = await fetch(`/api/clinics?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.clinics || [];
  };

  const handleGeolocate = async () => {
    if (!navigator.geolocation) {
      addMessage({ type: "bot", text: t.geoNoSupport });
      return;
    }

    setGeoLoading(true);
    addMessage({ type: "user", text: t.geoUserBubble });
    const typingId = addMessage({ type: "typing" });

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const params = new URLSearchParams({
            lat: latitude.toString(),
            lng: longitude.toString(),
          });
          const res = await fetch(`/api/clinics?${params}`);
          removeMessage(typingId);

          if (res.ok) {
            const data = await res.json();
            const clinics = data.clinics || [];
            if (clinics.length > 0) {
              addMessage({ type: "bot", text: t.geoResultsIntro });
              addMessage({ type: "clinics", clinics });
            } else {
              addMessage({ type: "bot", text: t.geoNoResults });
            }
          } else {
            addMessage({ type: "bot", text: t.geoApiError });
          }
        } catch {
          removeMessage(typingId);
          addMessage({ type: "bot", text: t.geoCatchError });
        }
        setGeoLoading(false);
      },
      () => {
        removeMessage(typingId);
        addMessage({ type: "bot", text: t.geoDenied });
        setGeoLoading(false);
      },
      { timeout: 10000, enableHighAccuracy: false }
    );
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText || inputValue).trim();
    if (!text || isLoading) return;

    // Intercept the "who is this for" quick replies
    if (text === t.whoForMyself || text === t.whoForChild || text === t.whoForOther) {
      setInputValue("");
      addMessage({ type: "user", text });
      setPatientContext(
        text === t.whoForMyself ? "self" : text === t.whoForChild ? "child" : "other"
      );
      const typingId = addMessage({ type: "typing" });
      setTimeout(() => {
        removeMessage(typingId);
        showSymptomPrompt();
      }, 500);
      return;
    }

    // Intercept geolocation quick reply
    if (text === t.qrFindClinics) {
      handleGeolocate();
      return;
    }

    setInputValue("");
    setIsLoading(true);

    // Show user message
    addMessage({ type: "user", text });

    // Client-side red flag check (defense-in-depth — fires instantly)
    const redFlag = checkRedFlags(text);
    if (redFlag) {
      const typingId = addMessage({ type: "typing" });
      await new Promise((r) => setTimeout(r, 600));
      removeMessage(typingId);

      if (redFlag === "911") {
        addMessage({
          type: "alert-911",
          alertTitle: "This may be a medical emergency.",
          alertBody:
            "What you described could be serious. Please call 911 right now. Don't wait \u2014 urgent care is not the right place for this.",
          alertCta: "Call 911",
          alertHref: "tel:911",
          alertAriaLabel: "Call 911 emergency services",
          alertNote: "If you can't call, have someone drive you to the nearest emergency room.",
        });
      } else if (redFlag === "988") {
        addMessage({
          type: "alert-988",
          alertTitle: "I want you to be safe.",
          alertBody:
            "Please reach out to the 988 Suicide & Crisis Lifeline. You don't have to handle this alone.",
          alertCta: "Call 988",
          alertHref: "tel:988",
          alertAriaLabel: "Call the 988 Suicide and Crisis Lifeline",
          alertTextCta: "Text 988",
          alertTextHref: "sms:988",
          alertTextAriaLabel: "Text the 988 Suicide and Crisis Lifeline",
          alertNote: "Free, confidential, available 24/7. You can also chat at 988lifeline.org.",
        });
      } else if (redFlag === "pediatric") {
        addMessage({
          type: "alert-911",
          alertTitle: "For a young child, this needs ER-level care.",
          alertBody:
            "For an infant or young child with these symptoms, please call 911 or go to a pediatric emergency room \u2014 not urgent care.",
          alertCta: "Call 911",
          alertHref: "tel:911",
          alertAriaLabel: "Call 911 emergency services",
        });
      }

      // Still add to conversation history so the LLM has context if they continue
      setConversationHistory((prev) => [
        ...prev,
        { role: "user", content: text },
      ]);

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
        body: JSON.stringify({ messages: newHistory, patientContext, language }),
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

      // Check if the LLM response is a red-flag alert (server-side detection)
      if (
        /call 911/i.test(assistantText) &&
        /emergency|ER|serious/i.test(assistantText)
      ) {
        addMessage({
          type: "alert-911",
          alertTitle: t.alert911Title,
          alertBody: assistantText,
          alertCta: t.alert911Cta,
          alertHref: "tel:911",
          alertAriaLabel: t.alert911AriaLabel,
          alertNote: t.alert911Note,
        });
      } else if (
        /988/i.test(assistantText) &&
        /suicid|crisis|safe/i.test(assistantText)
      ) {
        addMessage({
          type: "alert-988",
          alertTitle: t.alert988Title,
          alertBody: assistantText,
          alertCta: t.alert988Cta,
          alertHref: "tel:988",
          alertAriaLabel: t.alert988AriaLabel,
          alertTextCta: t.alert988TextCta,
          alertTextHref: "sms:988",
          alertTextAriaLabel: t.alert988TextAriaLabel,
          alertNote: t.alert988Note,
        });
      } else {
        // Normal bot message
        const careLevel: CareLevel | undefined =
          data.careLevel === "urgent" || data.careLevel === "self_care"
            ? data.careLevel
            : undefined;
        addMessage({ type: "bot", text: assistantText, careLevel });
      }

      // If the LLM triggered a clinic search, fetch and display results
      if (data.clinicSearch) {
        const { zip: searchZip, insurance: searchInsurance } =
          data.clinicSearch;
        const clinics = await fetchClinics(searchZip, searchInsurance);

        if (clinics.length > 0) {
          addMessage({ type: "clinics", clinics });
        } else {
          addMessage({ type: "bot", text: t.clinicSearchNoResults });
        }
      }
    } catch (err) {
      removeMessage(typingId);
      console.error("Chat error:", err);
      addMessage({ type: "bot", text: t.chatConnectError });
    }

    setIsLoading(false);
    inputRef.current?.focus();
  };

  return (
    <>
      {showDisclaimer && (
        <div className="disclaimer-overlay" role="presentation">
          <div
            className="disclaimer-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="disclaimer-title"
            aria-describedby="disclaimer-body"
          >
            <div id="disclaimer-title" className="disclaimer-modal-title">
              {t.disclaimerTitle}
            </div>
            <div id="disclaimer-body" className="disclaimer-modal-body">
              <ul>
                {t.disclaimerItems.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
            <button
              className="disclaimer-modal-btn"
              onClick={acknowledgeDisclaimer}
              autoFocus
            >
              {t.disclaimerBtn}
            </button>
          </div>
        </div>
      )}

      {embed ? (
        <div className="embed-topbar">
          <button className="lang-toggle" onClick={toggleLanguage}>
            {t.langToggleLabel}
          </button>
        </div>
      ) : (
        <header className="site-header">
          <div className="brand">
            <span className="dot"></span>urgentcare
            <span className="tld">.chat</span>
          </div>
          <div className="header-actions">
            <button className="lang-toggle" onClick={toggleLanguage}>
              {t.langToggleLabel}
            </button>
          </div>
        </header>
      )}

      {!embed && !hasStarted && (
        <section className="hero">
          <div className="hero-blob hero-blob-a" aria-hidden="true" />
          <div className="hero-blob hero-blob-b" aria-hidden="true" />
          <div className="hero-inner">
            <div className="hero-eyebrow">
              <span className="hero-eyebrow-dot" aria-hidden="true" />
              Free &middot; No signup &middot; 24/7
            </div>
            <h1 className="hero-title">Care, the moment you need it.</h1>
            <p className="hero-sub">
              Describe what&apos;s going on and get AI-guided triage and real
              clinics nearby, in seconds.
            </p>
            <svg className="hero-pulse" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">
              <polyline
                points="0,20 60,20 75,20 85,4 95,36 105,20 120,20 160,20 175,20 185,8 195,32 205,20 220,20 300,20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="hero-trust-row">
              <span className="hero-trust-badge">
                <span className="hero-trust-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </span>
                Not a diagnosis tool
              </span>
              <span className="hero-trust-badge">
                <span className="hero-trust-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </span>
                Real, nearby clinics
              </span>
              <span className="hero-trust-badge">
                <span className="hero-trust-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="11" width="16" height="9" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                </span>
                Private &amp; secure
              </span>
            </div>
          </div>
        </section>
      )}

      <main className={embed ? "app embed" : "app"}>
        <div className="disclaimer">
          <strong>{t.disclaimerBannerNotDoctor}</strong> {t.disclaimerBannerBody}
        </div>

        <div className="chat" role="log" aria-label="Chat conversation" aria-live="polite">
          {messages.map((msg) => {
            if (msg.type === "typing") {
              return (
                <div key={msg.id} className="msg bot" role="status" aria-label="Assistant is typing">
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
                <div key={msg.id} className="msg bot" role="alert">
                  <div className="msg-label">Assistant</div>
                  <div className={cssClass}>
                    <div className="alert-title">{msg.alertTitle}</div>
                    <div>{msg.alertBody}</div>
                    <div className="alert-actions">
                      <a
                        className="alert-cta"
                        href={msg.alertHref}
                        aria-label={msg.alertAriaLabel}
                      >
                        {msg.alertCta}
                      </a>
                      {msg.alertTextHref && (
                        <a
                          className="alert-cta alert-cta-secondary"
                          href={msg.alertTextHref}
                          aria-label={msg.alertTextAriaLabel}
                        >
                          {msg.alertTextCta}
                        </a>
                      )}
                    </div>
                    {msg.alertNote && <p className="alert-note">{msg.alertNote}</p>}
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
                  <div className="clinic-list" role="list" aria-label="Urgent care clinics near you">
                    {msg.clinics.map((c, i) => (
                      <div
                        key={i}
                        className={`clinic-card${c.featured ? " featured" : ""}`}
                        role="listitem"
                      >
                        {c.featured && <div className="featured-tag">{t.featuredTag}</div>}
                        <div className="clinic-name">{c.name}</div>
                        <div className="clinic-meta">
                          <span>{c.distance}</span>
                          <span aria-hidden="true">&middot;</span>
                          <span className={c.open ? "open" : "closed"}>
                            {c.hours}
                          </span>
                          {c.rating > 0 && (
                            <>
                              <span aria-hidden="true">&middot;</span>
                              <span aria-label={`Rating: ${c.rating} out of 5`}>
                                &#9733; {c.rating}
                              </span>
                            </>
                          )}
                        </div>
                        {c.address && (
                          <div className="clinic-address">{c.address}</div>
                        )}
                        {(c.services.length > 0 || c.insurance.length > 0) && (
                          <div className="clinic-tags">
                            {c.services.map((s) => (
                              <span key={s} className="tag">
                                {s.replace(/_/g, " ")}
                              </span>
                            ))}
                            {c.insurance.map((ins) => (
                              <span key={ins} className="tag insurance">
                                {ins}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="clinic-actions">
                          <a
                            className="clinic-btn"
                            href={c.directionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => logClick(c.name, "directions")}
                            aria-label={`Get directions to ${c.name}`}
                          >
                            Directions
                          </a>
                          {c.phone && (
                            <a
                              className="clinic-btn secondary"
                              href={`tel:${c.phone.replace(/\D/g, "")}`}
                              onClick={() => logClick(c.name, "call")}
                              aria-label={`Call ${c.name} at ${c.phone}`}
                            >
                              Call {c.phone}
                            </a>
                          )}
                          {c.websiteUrl && (
                            <a
                              className="clinic-btn secondary"
                              href={c.websiteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => logClick(c.name, "website")}
                              aria-label={`Visit ${c.name} website`}
                            >
                              Website
                            </a>
                          )}
                        </div>
                        <div className="clinic-footer-row">
                          <FollowUpOptIn
                            clinicName={c.name}
                            sessionId={getSessionId()}
                            labels={{
                              prompt: t.followUpPrompt,
                              placeholder: t.followUpPlaceholder,
                              submit: t.followUpSubmit,
                              submitting: t.followUpSubmitting,
                              success: t.followUpSuccess,
                              error: t.followUpError,
                            }}
                          />
                          <ClaimListing
                            clinicName={c.name}
                            placeId={c.placeId}
                            labels={{
                              prompt: t.claimPrompt,
                              namePlaceholder: t.claimNamePlaceholder,
                              emailPlaceholder: t.claimEmailPlaceholder,
                              submit: t.claimSubmit,
                              submitting: t.claimSubmitting,
                              success: t.claimSuccess,
                              error: t.claimError,
                            }}
                          />
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
                {msg.careLevel && (
                  <div className={`care-badge care-badge-${msg.careLevel}`}>
                    {msg.careLevel === "urgent" ? t.careUrgent : t.careSelf}
                  </div>
                )}
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
            placeholder={t.inputPlaceholder}
            autoComplete="off"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            aria-label="Describe your symptoms"
          />
          <button
            className="geo-btn"
            onClick={handleGeolocate}
            disabled={geoLoading}
            aria-label="Find clinics near my location"
            title="Use my location"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
              <circle cx="12" cy="12" r="8" />
            </svg>
          </button>
          <button
            id="send-btn"
            onClick={() => handleSend()}
            disabled={isLoading || !inputValue.trim()}
            aria-label="Send message"
          >
            Send
          </button>
        </div>
        <div className="footer-note">
          {embed ? (
            <a
              href="https://urgentcare.chat"
              target="_blank"
              rel="noopener noreferrer"
              className="embed-attribution"
            >
              Powered by urgentcare.chat
            </a>
          ) : (
            <>
              {t.footerNote}
              {" · "}
              <Link href="/terms">Terms</Link>
              {" · "}
              <Link href="/privacy">Privacy</Link>
              {" · "}
              <Link href="/disclaimer">Disclaimer</Link>
              {" · "}
              <Link href="/partners">White-label</Link>
              {!hasEmergencyAlert && process.env.NEXT_PUBLIC_TIP_JAR_URL && (
                <>
                  {" · "}
                  <a
                    href={process.env.NEXT_PUBLIC_TIP_JAR_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tip-link"
                  >
                    Help keep this free ☕
                  </a>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

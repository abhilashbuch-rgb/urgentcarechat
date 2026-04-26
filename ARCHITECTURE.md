# urgentcare.chat — Architecture & 7-Day Build Plan

**Owner:** Abhilash Buch
**Version:** 0.1 (MVP)
**Goal:** Launch a free, low-friction symptom triage + clinic discovery web app nationwide in 7 days, with a path to monetize via featured listings and affiliate booking.

---

## 1. Product scope (what it is, what it isn't)

**It is:** A conversational web app that helps a symptomatic user find a nearby urgent care, filtered by symptom relevance, distance, hours, and accepted insurance (as a tag, not a verified eligibility check).

**It is not:** A telemedicine platform, a diagnostic tool, a HIPAA-covered entity, a real-time eligibility verification service, or a booking engine. (Those can come later.)

**Core user flow (4–6 turns):**
1. Safety disclaimer + "What's going on?"
2. Severity / duration clarification
3. Red-flag check → if triggered, route to 911 or 988
4. Location (zip or geolocation)
5. Insurance tag (optional, dropdown)
6. Top 3 clinics with directions, hours, accepted insurance tags, and an outbound link

---

## 2. Architecture overview

```
┌──────────────────┐
│   User browser   │
│  (urgentcare.chat)│
└────────┬─────────┘
         │ HTTPS
         ▼
┌─────────────────────────────────────────┐
│  Static frontend (Vercel / Netlify)     │
│  - HTML/CSS/JS chat UI                   │
│  - Calls backend for AI + clinic search  │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Backend API (Vercel serverless funcs    │
│   or Cloudflare Workers)                 │
│   ┌─────────────────────────────────┐   │
│   │ /api/chat   → Anthropic API     │   │
│   │ /api/clinics → Google Places    │   │
│   │ /api/clinic/:id → DB lookup      │   │
│   └─────────────────────────────────┘   │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Data layer                              │
│   - Supabase (Postgres) for clinic       │
│     overrides, featured listings,        │
│     insurance tags, click logs           │
│   - Google Places as primary source      │
└─────────────────────────────────────────┘
```

**Why this stack:**
- Static frontend = zero server cost at idle, instant CDN delivery
- Serverless backend = no infra to babysit, scales automatically
- Supabase = free tier covers MVP, gives you a Postgres DB + auth + admin UI for free
- Anthropic Claude API for the LLM (or OpenAI — pick whichever account you already have)

---

## 3. APIs & services

| Service | Purpose | Cost at MVP | Notes |
|---|---|---|---|
| **Anthropic / OpenAI** | LLM for triage conversation | ~$0.001–0.01 per conversation | Use Claude Haiku or GPT-4o-mini for cost; upgrade if quality lacking |
| **Google Places API** | Clinic discovery (name, address, hours, rating) | $200/mo free credit (~11K–28K calls) | Use "Text Search" + "Place Details"; cache aggressively |
| **Supabase** | DB + admin panel | Free tier: 500MB DB, 50K monthly active users | Holds your clinic overrides, featured listings, click logs |
| **Vercel / Netlify** | Frontend + serverless | Free tier ample for MVP | Pick Vercel if using Next.js, Netlify if vanilla |
| **Cloudflare** | DNS + CDN + bot protection | Free | Point urgentcare.chat at Vercel via Cloudflare |
| **Google Analytics 4** | Conversion tracking | Free | Track: started chat, got results, clicked clinic |

**Optional (later, not in 7-day sprint):**
- Twilio for SMS clinic info to user
- Solv Health partner API for booking handoff
- Stripe for featured listing payments

---

## 4. Data model

Keep it minimal. Three tables.

### `clinics` (your override layer on top of Google Places)
```
id              uuid primary key
google_place_id text unique         -- ties back to Google's data
name            text
address         text
phone           text
website         text
lat             float8
lng             float8
hours_json      jsonb                -- structured hours
services        text[]               -- ['xray', 'pediatric', 'iv', 'std_testing', 'covid']
insurance_tags  text[]               -- ['aetna', 'bcbs', 'cigna', 'medicare', ...]
is_featured     boolean default false
featured_until  timestamp
claimed_by      uuid references users(id)
created_at      timestamp
updated_at      timestamp
```

### `clicks` (so you know what's working)
```
id              uuid primary key
clinic_id       uuid references clinics(id)
session_id      text                 -- random, not tied to user identity
event_type      text                 -- 'view', 'click_directions', 'click_website', 'click_call'
referrer_zip    text                 -- zip user searched, NOT user's zip from IP
created_at      timestamp
```

### `conversations` (de-identified, for QA only)
```
id              uuid primary key
session_id      text
turns_json      jsonb                -- array of {role, content_summary} — DO NOT store raw symptom text long-term
red_flag_triggered boolean
zip_searched    text
clinics_shown   uuid[]
created_at      timestamp
ttl_expires_at  timestamp            -- auto-purge after 30 days
```

**Privacy note:** `turns_json` stores a *summary* (e.g., "user reported respiratory symptoms, 2 days duration") not the raw chat. Auto-purge after 30 days. Document this in your privacy policy.

---

## 5. The 7-day sprint

| Day | Focus | Deliverable |
|---|---|---|
| **1** | Setup & scaffolding | Domain pointed to Vercel. Repo created. Supabase project up. API keys obtained (Anthropic, Google Places). Boilerplate HTML/JS chat shell rendering. |
| **2** | AI triage logic | System prompt finalized + integrated. End-to-end: user types symptom → AI asks clarifying Q → red flags route to 911/988. No clinic logic yet. |
| **3** | Google Places integration | `/api/clinics?lat=&lng=&zip=` returns top 5 urgent care results. Frontend renders cards. |
| **4** | Insurance tag filter + clinic overrides | Supabase clinic table seeded with manual data for ~50 clinics in Philly + NJ metro. Insurance dropdown filters results. |
| **5** | Polish + safety review | UI cleanup. Test all red-flag triggers (chest pain, stroke FAST, suicidal ideation, severe allergic reaction, pediatric fever <3mo). Test on mobile. |
| **6** | Analytics + featured listings | GA4 events firing for view/click. Supabase admin can mark a clinic `is_featured=true` and it pins to top. Stripe payment link drafted (not live). |
| **7** | Launch | DNS final. Privacy policy + ToS published (template + a healthcare attorney pass on Monday). Soft launch to AFC Narberth patients first, then post on r/AskDocs, r/UrgentCare, X. |

**What you don't do this week:** real-time eligibility, booking, telehealth, ads, mobile app, multi-language. All of that is post-launch if traffic justifies it.

---

## 6. Safety rails (non-negotiable)

These must be hardcoded in the system prompt AND verified with manual test cases on Day 5:

1. **First message of every conversation** opens with: "I'm an AI assistant, not a doctor. If this is a life-threatening emergency, call 911."
2. **Red-flag triggers (immediate 911 prompt, halt triage):**
   - Chest pain, pressure, or arm/jaw radiating pain
   - Difficulty breathing or shortness of breath at rest
   - Stroke FAST signs (face droop, arm weakness, slurred speech, sudden confusion)
   - Severe allergic reaction (throat swelling, anaphylaxis signs)
   - Severe head injury / loss of consciousness
   - Severe uncontrolled bleeding
   - Signs of sepsis (high fever + altered mental status)
   - Pregnancy with severe abdominal pain or bleeding
   - Infant under 3 months with fever > 100.4°F
3. **988 trigger (suicide & crisis lifeline):**
   - Any mention of self-harm, suicide, wanting to die, being a danger to self
4. **Never diagnose.** Always phrase as "It sounds like you're describing X — an urgent care provider can evaluate this."
5. **Never recommend specific medications or dosages.**
6. **Never request or store** SSN, full name, DOB, member ID, or any other PHI.

---

## 7. Legal / compliance checklist

Before public launch:

- [ ] Privacy policy clearly states: not a covered entity, not providing medical advice, not storing PHI
- [ ] Terms of Service: limitation of liability, no warranty, arbitration clause
- [ ] Healthcare attorney review (~$1.5–2.5K, ~1 week turnaround) — non-negotiable
- [ ] Cookie consent banner (CCPA/GDPR posture even if you don't think you need it)
- [ ] Featured listing disclosure: "Sponsored" or "Featured" tag visible on paid placements (FTC requirement)
- [ ] No PHI in URLs, logs, or analytics events

---

## 8. Monetization (post-launch, ordered by feasibility)

1. **Featured clinic listings** — clinics pay $99–$299/month to pin to top of their zip. Easiest. Sell to AFC franchisees first.
2. **Affiliate booking handoff** — Solv Health and similar pay per booking. Confirm partner terms before relying on this.
3. **White-label B2B** — sell the whole chatbot stack to urgent care chains as a front-desk deflection tool. Highest leverage path. Run it at AFC Narberth first to gather case-study data on call volume reduction.
4. **Display ads** — only as last resort; degrades trust on a health site.

---

## 9. Risks & open questions

- **Google Places hours data is unreliable** for many independent clinics. Plan for clinic-claimed listings to override with verified hours.
- **Clinic insurance lists are a maintenance burden.** Either crowdsource via clinic claim flow, scrape and re-verify quarterly, or limit to a curated metro at first.
- **Liability exposure** if a user follows the bot's recommendation, has a bad outcome, and sues. Mitigated by ToS + insurance, not eliminated. Talk to your business insurance broker about a cyber/E&O rider.
- **AI hallucination risk** — even with a tight system prompt, the model can drift. Build a feedback button ("This response was unhelpful") and review weekly.

---

## 10. Success metrics for first 30 days

- 1,000+ conversations started
- 60%+ reach a clinic recommendation (vs. dropping off)
- 20%+ click through to a clinic
- Zero safety incidents (red-flag triggers correctly route to 911/988 in 100% of test cases)
- 5+ clinics inquire about featured listings

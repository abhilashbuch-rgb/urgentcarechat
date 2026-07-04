// Shared red-flag detection — used by both the free triage chat
// (app/page.tsx) and the paid telehealth intake screen (app/telehealth)
// so "screen out emergencies before charging" uses the exact same
// rules as the free chat's defense-in-depth check.

export const RED_FLAGS_911 = [
  /chest pain|chest pressure|crushing chest|tight chest/i,
  /can'?t breathe|cannot breathe|trouble breathing|short(ness)? of breath|gasping/i,
  /face drooping|one[- ]sided weakness|slurred speech|sudden confusion/i,
  /severe (head|abdominal) (injury|pain)/i,
  /severe (allergic|bleeding)|anaphylaxis|throat swelling|can'?t swallow/i,
  /coughing up blood|vomiting blood/i,
  /unresponsive|seizure|overdose/i,
  /pregnan(t|cy).*(bleeding|severe pain)/i,
];

export const RED_FLAGS_988 = [
  /kill myself|suicid(e|al)|end my life|want to die|hurt myself|self.?harm/i,
];

export const RED_FLAGS_PED = [
  /(baby|infant|newborn|month old|weeks old).*fever/i,
  /fever.*(baby|infant|newborn|month old|weeks old)/i,
];

export function checkRedFlags(text: string): "911" | "988" | "pediatric" | null {
  if (RED_FLAGS_988.some((r) => r.test(text))) return "988";
  if (RED_FLAGS_911.some((r) => r.test(text))) return "911";
  if (RED_FLAGS_PED.some((r) => r.test(text))) return "pediatric";
  return null;
}

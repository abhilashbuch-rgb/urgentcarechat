// One fact a day, on the Today screen — the kind of thing a shift
// deserves to see once, not a stream to scroll.
//
// CURATED, NOT GENERATED. Every entry here is a well-established,
// easily-verified fact about the history of the practice these people
// work in — the sort of thing already in any general history-of-medicine
// reference. Nothing invented, nothing obscure enough to need a citation
// nobody could check on shift. If this list ever grows, the same bar
// applies: verifiable before it ships, not verified after somebody
// repeats it wrong to a patient.
//
// ROTATES BY THE CLINIC'S OWN CALENDAR DAY, not a random pick on every
// load — so the fact printed on a shared screen at 7am and again at
// 11am is the same one, and "today's fact" means what it says.

export const HISTORY_FACTS: string[] = [
  "The stethoscope was invented in 1816 by René Laennec, who rolled a sheet of paper into a tube rather than press his ear to a patient's chest.",
  "Edward Jenner tested the first vaccine in 1796, using cowpox matter from a milkmaid's lesion to protect against smallpox.",
  "Ignaz Semmelweis showed in 1847 that handwashing with chlorinated lime sharply cut childbed fever deaths in his maternity ward — years before germ theory explained why.",
  "Wilhelm Röntgen discovered X-rays in 1895. The first medical X-ray image ever taken was of his wife's hand.",
  "Alexander Fleming discovered penicillin in 1928 after noticing that mold growing in an uncovered petri dish had killed the bacteria around it.",
  "Karl Landsteiner's discovery of the ABO blood groups in 1901 made safe blood transfusion possible for the first time.",
  "Marie Curie built mobile X-ray units — nicknamed \"petites Curies\" — and drove them to the front lines to treat wounded soldiers in World War I.",
  "Insulin was first used to treat a person with diabetes in January 1922, saving the life of 14-year-old Leonard Thompson in Toronto.",
  "The World Health Organization declared smallpox eradicated in 1980 — still the only human disease ever eliminated by vaccination.",
  "Elizabeth Blackwell became the first woman to earn a medical degree in the United States, graduating in 1849.",
  "The first clinical CT scan was performed in 1971 by Godfrey Hounsfield — a single head scan that took hours to process.",
  "Public anesthesia's first successful demonstration was ether, given by William Morton at Massachusetts General Hospital in 1846.",
  "Louis Pasteur's rabies vaccine was used on a human for the first time in 1885, saving a boy who had been bitten nine times.",
  "The first pacemaker implanted in a human ran in 1958 in Sweden — and lasted about three hours before the patient's own repair had to begin.",
  "Jonas Salk's polio vaccine was declared safe and effective in 1955, triggering one of the largest mass-immunization campaigns in history.",
  "The first successful kidney transplant was performed in 1954 between identical twins, sidestepping the rejection problem nobody could yet solve.",
  "Florence Nightingale's statistical charts from the Crimean War are credited with founding modern hospital sanitation and epidemiology.",
  "The first automated external defibrillator for lay rescuers was developed in the 1970s, putting a hospital-grade intervention into a wall-mounted box.",
  "Aspirin was first sold in 1899, derived from salicin, a compound found in willow bark used medicinally since antiquity.",
  "The first successful open-heart surgery on a beating human heart was performed by Daniel Hale Williams in 1893, before the invention of blood transfusion or antibiotics.",
];

/** Day of the year, 1-366, in the given IANA zone — so a clinic in
 *  Phoenix and one in Narberth are never mid-flip on the same fact at
 *  the same moment their clocks disagree. */
function dayOfYear(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const start = Date.UTC(y, 0, 1);
  const today = Date.UTC(y, m - 1, d);
  return Math.floor((today - start) / 86_400_000) + 1;
}

export function factOfTheDay(timezone: string, now: Date = new Date()): string {
  let day: number;
  try {
    day = dayOfYear(now, timezone);
  } catch {
    // An invalid zone name must not cost the page its fact — a wrong
    // rotation day is a cosmetic gap, not a reason to show nothing.
    day = dayOfYear(now, "UTC");
  }
  return HISTORY_FACTS[day % HISTORY_FACTS.length];
}

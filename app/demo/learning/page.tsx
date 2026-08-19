import type { Metadata } from "next";
import DemoBanner from "@/app/components/demo/DemoBanner";
import { PRODUCT_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Demo: emergency guides — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false },
};

// The same four guides staff.emergency-seed.sql ships to a real clinic,
// trimmed to a few steps each for the walkthrough. Real wording, not
// invented for the demo — accuracy matters here even on a sample screen.
const GUIDES = [
  {
    key: "em-anaphylaxis",
    title: "Anaphylaxis",
    purpose: "Adrenaline first. Everything else second.",
    steps: [
      ["Call for the provider and the emergency kit, out loud, now.", "Do not leave the patient to go and find someone quietly."],
      ["Give intramuscular adrenaline into the outer thigh.", "Adult 0.3–0.5 mg of 1 mg/mL. Paediatric dosing is by weight."],
      ["Call 911.", "Every anaphylaxis goes to hospital, including the ones that improve."],
      ["Repeat adrenaline after 5 to 15 minutes if there is no improvement.", "On the provider's call. Same dose, same route, other thigh."],
    ],
  },
  {
    key: "em-code-blue",
    title: "Unresponsive patient — code blue",
    purpose: "Compressions, cart, AED, 911.",
    steps: [
      ["Shout for help and send someone specific for the crash cart and AED.", "Name a person. “Somebody get the cart” is how nobody goes."],
      ["Check for a response and for normal breathing. No more than 10 seconds.", "Gasping is not breathing."],
      ["Start compressions and call 911.", "The moment help is called for, not after the first cycle."],
      ["Put the AED on as soon as it arrives and follow its prompts.", null],
    ],
  },
  {
    key: "em-eye-splash",
    title: "Splash to the eyes or face",
    purpose: "Fifteen minutes of irrigation before anything else.",
    steps: [
      ["Get to the eyewash station and start irrigating immediately.", "Seconds matter more than anything else on this list."],
      ["Hold the eyelids open.", "The reflex is to squeeze them shut, which is the one thing that stops it working."],
      ["Irrigate for a full 15 minutes by the clock.", "It will feel far longer than it is. Have someone time it."],
    ],
  },
  {
    key: "em-needlestick",
    title: "Needlestick or sharps injury",
    purpose: "Wash, report now. Prophylaxis is time-limited.",
    steps: [
      ["Wash the site with soap and running water.", "Do not squeeze the wound and do not put bleach or disinfectant into it."],
      ["Report it to the provider or manager immediately.", "Before the end of the shift, however minor it looks."],
      ["Understand the clock.", "HIV post-exposure prophylaxis works best started within hours."],
    ],
  },
] as const;

export default function DemoLearning() {
  return (
    <div className="st-page">
      <DemoBanner role="provider" />
      <header className="st-page-head">
        <h1 className="st-h1">Emergencies</h1>
        <p className="st-page-sub">What to do. Read now, not during.</p>
      </header>

      <div className="st-notice" role="status">
        <strong>These are worth reading before you need them</strong>
        <span>
          Nothing here is signed for and nothing is recorded when you open
          it. Every step is visible at once &mdash; no Next button, nothing
          collapsed &mdash; because a paginated anaphylaxis procedure is a
          procedure that gets abandoned halfway.
        </span>
      </div>

      {GUIDES.map((g) => (
        <section key={g.key} className="st-emg" id={g.key}>
          <header className="st-emg-head">
            <h2 className="st-emg-title">{g.title}</h2>
            <p className="st-emg-purpose">{g.purpose}</p>
          </header>
          <ol className="st-emg-steps">
            {g.steps.map((s, i) => (
              <li key={i} className="st-emg-step">
                <span className="st-emg-no">{i + 1}</span>
                <div>
                  <p className="st-emg-instruction">{s[0]}</p>
                  {s[1] && <p className="st-emg-detail">{s[1]}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

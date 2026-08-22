"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ARCHETYPES,
  REQUIRED,
  JOB_LABEL,
  encodeConfig,
  type Archetype,
} from "@/lib/demo/config";

// Set up a demo clinic, then walk into it.
//
// WHY A WIZARD AND NOT A ROLE PICKER. The old /demo asked "who are you"
// and showed four fixed screens. That answers a question nobody buying
// this has — an evaluator does not want to see a medical assistant's
// screen in the abstract, they want to see THEIR clinic's screen, and
// the gap between those two is the entire sale. A med spa owner shown a
// board with a lead-apron inspection on it concludes the product is for
// somebody else.
//
// So: pick the shape, switch off what you do not own, walk in. The
// screen they land on is the one they would actually get.
//
// ONE PAGE, NOT FOUR STEPS. The steps in a wizard exist to hide
// complexity, and there is not enough here to hide: three archetypes and
// at most three switches. Numbered sections that all stay visible let
// somebody change their mind about step one without losing step two,
// which is what people actually do when they are evaluating something.

export default function DemoWizard() {
  const router = useRouter();
  const [archetype, setArchetype] = useState<Archetype | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());

  function pick(a: Archetype) {
    setArchetype(a);
    // Each archetype's own defaults, not whatever was ticked for the
    // last one. Switching from urgent care to a med spa and keeping a
    // lead-apron toggle would be nonsense.
    setOn(new Set(a.modules.filter((m) => m.on).map((m) => m.key)));
  }

  function toggle(key: string) {
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const active = archetype
    ? archetype.modules.filter((m) => on.has(m.key))
    : [];

  // Who ends up doing what. Only jobs with something on their board.
  const byJob = new Map<string, string[]>();
  for (const m of active) {
    byJob.set(m.job, [...(byJob.get(m.job) ?? []), m.label]);
  }

  return (
    <div className="demo-wiz">
      <section className="demo-wiz-step">
        <h2 className="demo-wiz-h">
          <span className="demo-wiz-n">1</span> What kind of clinic?
        </h2>
        <div className="demo-arch-grid">
          {ARCHETYPES.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`demo-arch${archetype?.key === a.key ? " demo-arch-on" : ""}`}
              aria-pressed={archetype?.key === a.key}
              onClick={() => pick(a)}
            >
              <span className="demo-arch-label">{a.label}</span>
              <span className="demo-arch-blurb">{a.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      {archetype && (
        <>
          <section className="demo-wiz-step">
            <h2 className="demo-wiz-h">
              <span className="demo-wiz-n">2</span> What do you actually have?
            </h2>
            <p className="demo-wiz-b">
              Switched to what {archetype.phrase} usually runs. Change
              anything that is not true of yours.
            </p>

            <div className="st-set-checks">
              {archetype.modules.map((m) => (
                <label className="st-set-check" key={m.key}>
                  <input
                    type="checkbox"
                    checked={on.has(m.key)}
                    onChange={() => toggle(m.key)}
                  />
                  <span>
                    <strong>{m.label}</strong>
                    <em>{m.blurb}</em>
                  </span>
                </label>
              ))}
            </div>

            {/* THE HONEST HALF. A configuration screen that shows only
                the switches teaches a buyer that everything is optional,
                and the discovery that it was not comes on an inspection.
                These are listed without a toggle because there isn't
                one. */}
            <h3 className="demo-wiz-sub">On every board, whatever you pick</h3>
            <p className="demo-wiz-b">
              The clinic chooses what equipment it has. It does not choose
              what the law asks of it, so these have no switch.
            </p>
            <ul className="demo-fixed-list">
              {REQUIRED.map((r) => (
                <li className="demo-fixed" key={r.label}>
                  <span className="demo-fixed-label">{r.label}</span>
                  <span className="demo-fixed-why">{r.why}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="demo-wiz-step">
            <h2 className="demo-wiz-h">
              <span className="demo-wiz-n">3</span> Who ends up doing it
            </h2>
            <p className="demo-wiz-b">
              Every log belongs to a job, so nobody opens the app to
              somebody else&rsquo;s work. A medical assistant never sees the
              front desk&rsquo;s drawer count.
            </p>
            {byJob.size === 0 ? (
              <p className="demo-wiz-b">
                Nothing optional is switched on &mdash; every board would
                show the required logs above and nothing else.
              </p>
            ) : (
              <ul className="demo-role-map">
                {[...byJob.entries()].map(([job, labels]) => (
                  <li className="demo-role-row" key={job}>
                    <span className="demo-role-job">
                      {JOB_LABEL[job as keyof typeof JOB_LABEL]}
                    </span>
                    <span className="demo-role-items">{labels.join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button
            className="st-primary demo-wiz-go"
            type="button"
            onClick={() =>
              router.push(
                `/demo/today?c=${encodeURIComponent(
                  encodeConfig(archetype.key, [...on])
                )}`
              )
            }
          >
            Open this clinic&rsquo;s shift
          </button>
          <p className="demo-wiz-foot">
            Nothing is saved and no account is created. In the real product
            this is the same choice, made once on the settings page by the
            owner or the centre admin.
          </p>
        </>
      )}
    </div>
  );
}

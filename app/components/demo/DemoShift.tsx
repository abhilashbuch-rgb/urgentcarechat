"use client";

import { useState } from "react";
import DemoLogRunner from "@/app/components/demo/DemoLogRunner";

// The real Today screen, as fixture data, with the log one tap behind it
// exactly as it is in the product.
//
// STATE RATHER THAN A SECOND ROUTE. Sending the visitor to /demo/today/log
// would work, but the point being demonstrated is that filing a check is
// one tap from the screen you land on — and a page navigation in a demo
// reads as "and now here is a different feature". Keeping it in place
// makes the count go down in front of you, which is the whole argument.

interface Check {
  slug: string;
  name: string;
  slot: string | null;
}

// Four, and the first one is the fridge, because that is the one every
// urgent care in the country already keeps on a clipboard.
const DUE: Check[] = [
  { slug: "temp-fridge", name: "Refrigerator temperatures", slot: "Opening" },
  { slug: "crash-cart", name: "Crash cart & AED", slot: "Opening" },
  { slug: "narcotics-count", name: "Controlled substance count", slot: "Opening" },
  { slug: "sharps-containers", name: "Sharps containers", slot: null },
];

export default function DemoShift() {
  const [doneCount, setDoneCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [lastFiled, setLastFiled] = useState<{
    name: string;
    at: string;
    flagged: boolean;
  } | null>(null);

  const due = DUE.slice(doneCount);
  const next = due[0] ?? null;

  function onFiled(flagged: boolean) {
    setLastFiled({
      name: DUE[doneCount].name,
      at: new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }),
      flagged,
    });
    setDoneCount((n) => n + 1);
    setRunning(false);
  }

  if (running && next) {
    return <DemoLogRunner check={next} onFiled={onFiled} onCancel={() => setRunning(false)} />;
  }

  return (
    <>
      {lastFiled && (
        <div className="st-notice" role="status">
          <strong>
            Filed {lastFiled.at}. {lastFiled.name} is covered for this shift.
          </strong>
          <span>
            {lastFiled.flagged
              ? "It was filed with the corrective action you wrote, and it stays on the board rather than being cleared."
              : due.length === 0
                ? "That was the last one due today."
                : due.length === 1
                  ? "One check left this shift."
                  : `${due.length} checks left this shift.`}
          </span>
        </div>
      )}

      <section className="st-shift">
        <p className="st-shift-count">
          {due.length === 0
            ? "Everything due this shift is filed."
            : due.length === 1
              ? "1 check left this shift"
              : `${due.length} checks left this shift`}
        </p>
        {doneCount > 0 && (
          <p className="st-shift-done">{doneCount} already filed</p>
        )}

        {next ? (
          <button
            className="st-primary st-shift-go"
            type="button"
            onClick={() => setRunning(true)}
          >
            Start: {next.name}
          </button>
        ) : (
          <p className="st-shift-done">
            Nothing else is due. Anything filed today stays on the board and
            on the record.
          </p>
        )}
      </section>

      {/* THE ONE THING ON THE SCREEN THAT IS THEIRS. Every other row here
          is evidence somebody else will read; this is the person's own
          card, and it is the reason they open the app when nothing is
          due. Silent in the product unless something is actually
          approaching — shown here because a demo of an empty state
          demonstrates nothing. */}
      <section className="st-mycreds">
        <h2 className="st-h2">Your credentials</h2>
        <ul className="st-mycred-list">
          <li className="st-mycred st-mycred-expiring">
            <span className="st-mycred-kind">BLS / CPR</span>
            <span className="st-mycred-state">Expires in 34 days</span>
          </li>
        </ul>
        <span className="st-mycred-go">
          In the real app this links to your own document shelf.
        </span>
      </section>

      {doneCount > 0 && (
        <p className="st-foot">
          Nothing here was saved &mdash; this is a demo. On a real clinic
          each of these would be timestamped, signed to your account, and
          impossible to edit afterwards: a correction files a new record and
          keeps the original, so an inspector sees both.
        </p>
      )}
    </>
  );
}

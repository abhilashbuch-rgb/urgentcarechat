"use client";

import { useState } from "react";
import SharpsFillDiagram from "@/app/components/staff/SharpsFillDiagram";

// The same one-tap chips as the real shift log
// (app/components/staff/LogForm.tsx), reimplemented rather than reused.
// The real component's submit() posts to /api/staff/logs/submit, and a
// demo visitor has no session for that route to accept — importing it
// here and hoping the fetch fails harmlessly is exactly the kind of
// silent-failure UX this product's real forms go out of their way to
// avoid. This version never calls fetch at all.
//
// THE CORRECTIVE ACTION IS REAL HERE, AND IT DID NOT USED TO BE.
// This screen previously printed a paragraph explaining that an
// out-of-range reading requires twenty characters of corrective action
// and that "n/a" is rejected — and then let you file anyway, because
// "that field is skipped here since nothing is actually being filed".
//
// That was the wrong thing to skip. The gate is the product's entire
// argument: a binder full of readings nobody acted on is what a surveyor
// finds, and the whole point is that this software will not let you
// create one. An evaluator who reads about it is unconvinced; an
// evaluator who taps 11 degC, tries to type "n/a", and is refused has
// understood the product. So it is enforced, on the same rules as the
// real route.
//
// ONE TEMPLATE PER SLUG, NOT ONE FIXED FORM. This used to show the same
// fridge-temperature-and-O2-cylinder fields no matter which check was
// actually opened — correct only for whichever check happened to be
// first in the queue, and wrong (a fridge form under a narcotics-count
// or sharps-containers title) for every other one. A real NP clicking
// through the demo found that in minutes; a fixed form was never going
// to survive someone actually using it. DEMO_TEMPLATES below is a
// trimmed-down but real subset of each template's own fields in
// supabase/staff-logs-seed.sql / staff-sharps-waste.sql — not the full
// field list, but never a different check's fields.

const MIN_CORRECTIVE = 20;

/** Rejected outright however long the field is. Mirrors
 *  supabase/staff-corrective-action.sql — three characters used to be
 *  the only bar, and "n/a" cleared it. */
const TOKENS = new Set([
  "n/a", "na", "none", "nothing", "ok", "okay", "fine", "done",
  "no action", "no action taken", "n/a.", "-", "--",
]);

type FieldValue = number | boolean | string | null;

interface NumberField {
  id: string;
  label: string;
  type: "number";
  unit: string;
  min?: number;
  max?: number;
  decimals?: number;
  presets: number[];
  outOfRangeValue: number;
  outOfRangeLabel: string;
}

interface BooleanField {
  id: string;
  label: string;
  type: "boolean";
  expected: boolean;
  /** Shown above the Yes/No toggle — used once, for the one field where
   *  a fill level is hard to picture from the label alone. See
   *  app/components/staff/SharpsFillDiagram.tsx. */
  diagram?: boolean;
}

interface TextField {
  id: string;
  label: string;
  type: "text";
  placeholder?: string;
}

type DemoField = NumberField | BooleanField | TextField;

interface DemoTemplate {
  standard: string;
  fields: DemoField[];
}

const DEMO_TEMPLATES: Record<string, DemoTemplate> = {
  "temp-fridge": {
    standard: "Vaccine storage 2–8 °C. Any excursion means quarantine the stock.",
    fields: [
      {
        id: "current",
        label: "Vaccine fridge — current",
        type: "number",
        unit: "°C",
        min: 2,
        max: 8,
        decimals: 1,
        presets: [3.0, 3.2, 3.4, 3.6, 3.8],
        outOfRangeValue: 11,
        outOfRangeLabel: "Out of range / other",
      },
    ],
  },
  "crash-cart": {
    standard: "Both O2 cylinders above 1000 PSI. Suction pulls.",
    fields: [
      {
        id: "o2_primary",
        label: "Primary O2 cylinder",
        type: "number",
        unit: "PSI",
        min: 1000,
        presets: [2000, 1800, 1500],
        outOfRangeValue: 600,
        outOfRangeLabel: "Out of range / low",
      },
      { id: "suction_ok", label: "Suction unit pulls", type: "boolean", expected: true },
      { id: "seal_intact", label: "Breakaway seal intact", type: "boolean", expected: true },
    ],
  },
  "narcotics-count": {
    standard: "Two people count. A discrepancy is reported before anyone leaves the building.",
    fields: [
      { id: "safe_locked", label: "Safe was locked on arrival", type: "boolean", expected: true },
      {
        id: "count_a",
        label: "Lorazepam 2 mg/mL — vials",
        type: "number",
        unit: "vials",
        decimals: 0,
        presets: [12, 14, 16],
        outOfRangeValue: 9,
        outOfRangeLabel: "Doesn't match / other",
      },
      {
        id: "matches_record",
        label: "Physical count matches the running record",
        type: "boolean",
        expected: true,
      },
      {
        id: "witness_email",
        label: "Witness (work email)",
        type: "text",
        placeholder: "name@…",
      },
    ],
  },
  "sharps-containers": {
    standard: "Any container at or above three-quarters gets sealed and swapped now.",
    fields: [
      {
        id: "containers_checked",
        label: "Containers checked",
        type: "number",
        unit: "",
        decimals: 0,
        presets: [2, 3, 4],
        outOfRangeValue: 0,
        outOfRangeLabel: "Other",
      },
      {
        id: "any_over_three_quarters",
        label: "Any container at or above three-quarters",
        type: "boolean",
        expected: false,
        diagram: true,
      },
    ],
  },
};

/** Whatever the wizard switched on has no fixture built for it yet —
 *  shown honestly rather than borrowing another check's fields. */
const FALLBACK_TEMPLATE: DemoTemplate = {
  standard:
    "This log's fields aren't built out in the demo yet — in the real app this shows its own checklist, exactly like the ones above.",
  fields: [{ id: "done", label: "Completed without issue", type: "boolean", expected: true }],
};

function numberIsOut(f: NumberField, v: number): boolean {
  return (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max);
}

interface Check {
  slug: string;
  name: string;
  slot: string | null;
}

export default function DemoLogRunner({
  check,
  onFiled,
  onCancel,
}: {
  check: Check;
  onFiled: (flagged: boolean) => void;
  onCancel: () => void;
}) {
  const template = DEMO_TEMPLATES[check.slug] ?? FALLBACK_TEMPLATE;

  const [answers, setAnswers] = useState<Record<string, FieldValue>>(() => {
    const initial: Record<string, FieldValue> = {};
    for (const f of template.fields) {
      if (f.type === "number") initial[f.id] = f.presets[0] ?? null;
      if (f.type === "text") initial[f.id] = "";
      // booleans start unanswered, on purpose — see the seal question below.
    }
    return initial;
  });
  const [corrective, setCorrective] = useState("");
  const [refused, setRefused] = useState<string | null>(null);

  const booleanFields = template.fields.filter((f): f is BooleanField => f.type === "boolean");
  const unanswered = booleanFields.some((f) => answers[f.id] === undefined);

  const flaggedFields = template.fields.filter((f) => {
    const v = answers[f.id];
    if (f.type === "number") return typeof v === "number" && numberIsOut(f, v);
    if (f.type === "boolean") return typeof v === "boolean" && v !== f.expected;
    return false;
  });
  const flagged = flaggedFields.length > 0;

  const trimmed = corrective.trim();

  function set(id: string, value: FieldValue) {
    setAnswers((a) => ({ ...a, [id]: value }));
    setRefused(null);
  }

  function submit() {
    if (unanswered) return;
    if (!flagged) return onFiled(false);

    if (TOKENS.has(trimmed.toLowerCase())) {
      setRefused(
        "That is one of the answers this field exists to catch. Writing “n/a” beside something out of range is worse than no note at all — it reads as a complete record, so nobody chases it."
      );
      return;
    }
    if (trimmed.length < MIN_CORRECTIVE) {
      setRefused(
        `Twenty characters, not three. Say what you did about it: moved the stock, called the manufacturer, tagged the unit. You have written ${trimmed.length}.`
      );
      return;
    }
    onFiled(true);
  }

  return (
    <div className="st-log">
      <div className="st-log-by">
        <span>Dana Whitfield</span>
        <span>Today</span>
        {check.slot && <span className="st-log-slot">{check.slot}</span>}
      </div>

      <h2 className="st-h2">{check.name}</h2>

      <p className="st-log-standard">{template.standard}</p>

      <div className="st-log-fields">
        {template.fields.map((f) => {
          const v = answers[f.id];
          const isFlagged = flaggedFields.includes(f);

          if (f.type === "number") {
            const decimals = f.decimals ?? 0;
            return (
              <div key={f.id} className={`st-log-row${isFlagged ? " st-log-row-flag" : ""}`}>
                <div className="st-log-label">
                  <span>{f.label}</span>
                  {(f.min !== undefined || f.max !== undefined) && (
                    <span className="st-log-range">
                      {f.min !== undefined && f.max !== undefined
                        ? `${f.min}–${f.max}`
                        : f.min !== undefined
                          ? `≥ ${f.min}`
                          : `≤ ${f.max}`}
                      {f.unit ? ` ${f.unit}` : ""}
                    </span>
                  )}
                </div>
                <div className="st-log-input">
                  <div className="st-preset-row" role="group" aria-label={`${f.label} presets`}>
                    {f.presets.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`st-preset-chip${v === p ? " st-preset-on" : ""}`}
                        onClick={() => set(f.id, p)}
                      >
                        {p.toFixed(decimals)}
                        {f.unit ? ` ${f.unit}` : ""}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`st-preset-chip${v === f.outOfRangeValue ? " st-preset-on" : ""}`}
                      onClick={() => set(f.id, f.outOfRangeValue)}
                    >
                      {f.outOfRangeLabel}
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          if (f.type === "boolean") {
            return (
              <div key={f.id} className={`st-log-row${isFlagged ? " st-log-row-flag" : ""}`}>
                <div className="st-log-label">
                  <span>{f.label}</span>
                </div>
                <div className="st-log-input">
                  {f.diagram && <SharpsFillDiagram />}
                  <div className="st-toggle" role="group" aria-label={f.label}>
                    {[true, false].map((opt) => (
                      <button
                        key={String(opt)}
                        type="button"
                        className={`st-toggle-btn${v === opt ? " st-toggle-on" : ""}`}
                        aria-pressed={v === opt}
                        onClick={() => set(f.id, opt)}
                      >
                        {opt ? "Yes" : "No"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={f.id} className="st-log-row">
              <div className="st-log-label">
                <span>{f.label}</span>
              </div>
              <div className="st-log-input">
                <input
                  className="st-input"
                  type="text"
                  value={typeof v === "string" ? v : ""}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.id, e.target.value)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {flagged && (
        <div className="st-log-alert" role="alert">
          <strong>Out of range</strong>
          <p>
            This cannot be filed as a number alone. Say what you did about
            it &mdash; the reading and the response are one record, and a
            reading with no response is what a surveyor finds three years
            later.
          </p>
          <textarea
            className="st-input st-textarea"
            rows={3}
            value={corrective}
            onChange={(e) => { setCorrective(e.target.value); setRefused(null); }}
            placeholder="Moved stock to the backup unit, tagged DO NOT USE, called the vaccine programme for a viability decision."
            aria-label="Corrective action taken"
          />
          {refused && <p className="st-log-refused">{refused}</p>}
        </div>
      )}

      <button
        className={`st-primary${flagged ? " st-primary-warn" : ""}`}
        type="button"
        disabled={unanswered}
        onClick={submit}
      >
        {unanswered
          ? "Answer every question to file"
          : flagged
            ? "File with corrective action"
            : "File this check"}
      </button>

      {/* Only a length hint, and only when length is the problem. Showing
          "17 more characters" beside a refusal that was about the WORDS
          invites somebody to pad "n/a" out to twenty. */}
      {flagged &&
        !refused &&
        trimmed.length > 0 &&
        trimmed.length < MIN_CORRECTIVE && (
          <p className="st-field-hint">
            {MIN_CORRECTIVE - trimmed.length} more characters.
          </p>
        )}

      <button className="st-btn st-log-back" type="button" onClick={onCancel}>
        Back to Today
      </button>
    </div>
  );
}

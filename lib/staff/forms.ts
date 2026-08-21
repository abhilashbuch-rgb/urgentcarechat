import { z } from "zod";

// The shape of a log form. A template is data, so adding a form is a row,
// not a deploy.
//
// This module is the single definition of what a field is and when a
// value is out of range — imported by the renderer AND by the submit
// handler. Two implementations of "is 49°F too warm" would eventually
// disagree, and the one that matters is the server's.

const baseField = {
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(160),
  help: z.string().max(300).optional(),
  required: z.boolean().default(true),
};

export const fieldSchema = z.discriminatedUnion("type", [
  z.object({
    ...baseField,
    type: z.literal("number"),
    unit: z.string().max(12).optional(),
    /** Inclusive. A value below `min` or above `max` is out of range and
     *  forces a corrective action. */
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    /** One-tap values for the readings that land on the same few numbers
     *  shift after shift — a fridge that holds 38.0-38.4°F, an O2
     *  cylinder read in 500 PSI bands. Tapping one fills the input with
     *  that exact value; it is still the value stored and still runs
     *  through the same min/max check as if it had been typed, so a chip
     *  for 38.4°F still flags if `max` is 38. The raw input stays visible
     *  and editable beside the chips — there is no separate "custom"
     *  mode, because hiding the real input behind a toggle is what turns
     *  a shortcut into the only way to enter an unusual number. */
    presets: z.array(z.number()).max(6).optional(),
  }),
  z.object({ ...baseField, type: z.literal("text"), placeholder: z.string().max(80).optional() }),
  /** A sentence or a paragraph rather than a value: how an injury
   *  happened, what a patient said, what was done about it. Never
   *  checked against an expectation — prose has no out-of-range, and a
   *  narrative field that could flag would push people towards writing
   *  the answer that does not. */
  z.object({
    ...baseField,
    type: z.literal("textarea"),
    placeholder: z.string().max(120).optional(),
  }),
  z.object({ ...baseField, type: z.literal("date") }),
  z.object({
    ...baseField,
    type: z.literal("select"),
    options: z.array(z.string().min(1).max(80)).min(2).max(24),
    /** Options that mean "this failed" — selecting one is out of range. */
    failing: z.array(z.string()).default([]),
  }),
  z.object({
    ...baseField,
    type: z.literal("boolean"),
    /** Which answer is the good one. Answering the other way is out of
     *  range: "seal intact? no" is exactly the case the log exists for. */
    expected: z.boolean().default(true),
  }),
]);

export type Field = z.infer<typeof fieldSchema>;

export const formSchema = z.object({
  /** Rendered above the fields — the one line of standard the person is
   *  checking against, so nobody has to remember it. */
  standard: z.string().max(400).optional(),
  fields: z.array(fieldSchema).min(1).max(40),
});

export type FormSchema = z.infer<typeof formSchema>;

export type AnswerValue = string | number | boolean | null;
export type Answers = Record<string, AnswerValue>;

/** A field the person left blank that they shouldn't have. */
export interface FieldProblem {
  id: string;
  label: string;
  kind: "missing" | "not_a_number";
}

export interface Evaluation {
  missing: FieldProblem[];
  /** Field ids whose answers fall outside the acceptable range. */
  outOfRange: string[];
  /** Human-readable, for the corrective-action prompt and the alert. */
  outOfRangeLabels: string[];
}

/**
 * The one place that decides whether a set of answers is complete and
 * whether anything is out of range.
 *
 * Out of range is deliberately independent of required-ness: a value can
 * be present, valid, and alarming, which is the whole point.
 */
export function evaluate(schema: FormSchema, answers: Answers): Evaluation {
  const missing: FieldProblem[] = [];
  const outOfRange: string[] = [];
  const outOfRangeLabels: string[] = [];

  const flag = (f: Field) => {
    outOfRange.push(f.id);
    outOfRangeLabels.push(f.label);
  };

  for (const f of schema.fields) {
    const v = answers[f.id];
    const blank = v === undefined || v === null || v === "";

    if (blank) {
      if (f.required) missing.push({ id: f.id, label: f.label, kind: "missing" });
      continue;
    }

    switch (f.type) {
      case "number": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) {
          missing.push({ id: f.id, label: f.label, kind: "not_a_number" });
          break;
        }
        if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
          flag(f);
        }
        break;
      }
      case "boolean":
        if (Boolean(v) !== f.expected) flag(f);
        break;
      case "select":
        if (f.failing.includes(String(v))) flag(f);
        break;
      case "text":
      case "textarea":
      case "date":
        break;
    }
  }

  return { missing, outOfRange, outOfRangeLabels };
}

/** Coerces one raw form value to the type its field declares. Applied on
 *  the server to whatever the client sent, so a number field holds a
 *  number in the stored record regardless of how it arrived. */
export function coerce(field: Field, raw: unknown): AnswerValue {
  if (raw === undefined || raw === null || raw === "") return null;
  switch (field.type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case "boolean":
      return raw === true || raw === "true" || raw === "yes";
    // A narrative gets room. 500 characters is about four sentences,
    // and quietly cutting an account of how somebody was stuck with a
    // needle off mid-sentence would leave a record that reads as if the
    // writer stopped caring.
    case "textarea":
      return String(raw).slice(0, 4000);
    default:
      return String(raw).slice(0, 500);
  }
}

export const SLOT_LABELS: Record<string, string> = {
  am: "Opening",
  pm: "Closing",
  "": "Today",
};

/** The shift a given time of day falls in, used to preselect which of a
 *  twice-daily form's slots opens first. Local clinic time, not UTC —
 *  8pm Eastern is the closing check, not tomorrow morning's. */
export function currentSlot(now = new Date()): "am" | "pm" {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/New_York",
    }).format(now)
  );
  return hour < 13 ? "am" : "pm";
}

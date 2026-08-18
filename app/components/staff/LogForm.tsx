"use client";

import { useMemo, useRef, useState } from "react";
import { evaluate, type Answers, type Field, type FormSchema } from "@/lib/staff/forms";
import CameraProof, { type Proof } from "@/app/components/staff/CameraProof";

// The three logs where a photograph is worth the extra seconds, because
// the record is a number somebody typed and the evidence is a display
// somebody photographed.
const PHOTO_FORMS = new Set(["temp-fridge", "crash-cart", "poct-qc"]);
const PHOTO_LABELS: Record<string, string> = {
  "temp-fridge": "Photo of the min/max display (optional)",
  "crash-cart": "Photo of the breakaway seal (optional)",
  "poct-qc": "Photo of the control read window (optional)",
};

// One log, filled in from the keyboard.
//
// The design constraint is that this gets done between patients, on a
// phone, by someone who has filled the same form in two hundred times. So:
//
//  - Who and when are PRINTED, not asked. Name, date, and shift are known
//    the moment the page loads; making them fields would be three inputs
//    to tab past before reaching the first thing that isn't already known.
//  - Every value is one keystroke away. Enter moves to the next field,
//    numbers get a numeric keypad, and yes/no is two buttons rather than
//    a dropdown that costs a tap to open and a tap to choose.
//  - Out of range is shown the instant it is typed, not on submit. Finding
//    out at the end that a reading was alarming means re-reading the
//    thermometer, and this is exactly the moment the person is still
//    standing in front of it.

export default function LogForm({
  slug,
  slot,
  schema,
  signedBy,
  todayLabel,
  slotLabel,
}: {
  slug: string;
  slot: string;
  schema: FormSchema;
  signedBy: string;
  todayLabel: string;
  slotLabel: string;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [corrective, setCorrective] = useState("");
  // The photograph is uploaded AFTER the log is filed, never with it —
  // see app/api/staff/logs/photo/route.ts. A failed upload must not cost
  // the reading.
  const [proof, setProof] = useState<Proof | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Recomputed from the same function the server uses, so what the person
  // sees and what gets stored can't disagree about whether 49 °F is a
  // problem.
  const check = useMemo(() => evaluate(schema, answers), [schema, answers]);
  const flagged = check.outOfRange.length > 0;
  // Twenty characters, matching the CHECK constraint and the route.
  // Three stopped an empty box and nothing else — "n/a" against a
  // 52-degree fridge was accepted and filed. See
  // supabase/staff-corrective-action.sql.
  const MIN_CORRECTIVE = 20;
  const correctiveLeft = MIN_CORRECTIVE - corrective.trim().length;
  const correctiveOk = !flagged || correctiveLeft <= 0;

  function set(id: string, value: Answers[string]) {
    setAnswers((a) => ({ ...a, [id]: value }));
  }

  // Enter advances instead of submitting. On a form of eight numbers, a
  // stray Enter that submits early is worse than useless — it creates a
  // half-empty compliance record.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName === "TEXTAREA") return;
    e.preventDefault();
    const focusable = Array.from(
      formRef.current?.querySelectorAll<HTMLElement>("[data-field]") ?? []
    );
    const i = focusable.indexOf(target);
    focusable[i + 1]?.focus();
  }

  async function submit() {
    if (check.missing.length > 0) {
      setShowMissing(true);
      const first = formRef.current?.querySelector<HTMLElement>(
        `[data-field="${check.missing[0].id}"]`
      );
      first?.scrollIntoView({ block: "center", behavior: "smooth" });
      first?.focus();
      return;
    }
    if (!correctiveOk) return;

    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/staff/logs/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, slot, answers, correctiveAction: corrective.trim() }),
    }).catch(() => null);

    if (!res?.ok) {
      setSubmitting(false);
      setError(
        res?.status === 409
          ? "This log was already submitted for this shift."
          : res?.status === 402
            ? "This account is in read-only mode, so new entries can't be filed. Everything already recorded is still here and still exportable — an administrator needs to sort out billing."
            : "That didn't save. Nothing was recorded — try again."
      );
      return;
    }

    // THE LOG IS FILED. Everything after this point is a bonus and none
    // of it may undo the record or block the redirect: an upload that
    // fails on a bad corridor signal must not make somebody think their
    // reading was lost and file it a second time.
    if (proof) {
      const body = await res.json().catch(() => null);
      if (body?.id) {
        const fd = new FormData();
        fd.set("response_id", body.id);
        fd.set("file", new File([proof.blob], "proof.jpg", { type: proof.blob.type }));
        fd.set("caption", `${slug} ${slot}`.trim());
        await fetch("/api/staff/logs/photo", { method: "POST", body: fd }).catch(
          () => null
        );
      }
    }

    window.location.assign("/staff/logs?done=" + encodeURIComponent(slug));
  }

  return (
    <form
      ref={formRef}
      className="st-log"
      onKeyDown={onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* Known, so stated rather than asked. */}
      <div className="st-log-by">
        <span>{signedBy}</span>
        <span>{todayLabel}</span>
        <span className="st-log-slot">{slotLabel}</span>
      </div>

      {schema.standard && <p className="st-log-standard">{schema.standard}</p>}

      <div className="st-log-fields">
        {schema.fields.map((f, i) => (
          <FieldRow
            key={f.id}
            field={f}
            value={answers[f.id]}
            onChange={(v) => set(f.id, v)}
            autoFocus={i === 0}
            flagged={check.outOfRange.includes(f.id)}
            missing={showMissing && check.missing.some((m) => m.id === f.id)}
          />
        ))}
      </div>

      {flagged && (
        <div className="st-log-alert" role="alert">
          <strong>
            Out of range:{" "}
            {check.outOfRangeLabels.join(", ")}
          </strong>
          <p>
            This log can still be submitted — it has to be, the reading is the
            record. Say what you did about it.
          </p>
          <textarea
            className="st-textarea"
            value={corrective}
            onChange={(e) => setCorrective(e.target.value)}
            rows={3}
            placeholder="e.g. Moved stock to the backup fridge, tagged DO NOT USE, called the manufacturer, notified Dr Buch at 7:15."
            aria-label="Corrective action taken"
          />
        </div>
      )}

      {/* Photo proof. Optional on every form — a log must never be
          blocked on a camera. Offered on the three where a surveyor's
          next question is "show me". */}
      {PHOTO_FORMS.has(slug) && (
        <CameraProof
          label={PHOTO_LABELS[slug] ?? "Photo proof (optional)"}
          onChange={setProof}
          disabled={submitting}
        />
      )}

      {showMissing && check.missing.length > 0 && (
        <p className="st-log-missing" role="alert">
          Still needed: {check.missing.map((m) => m.label).join(", ")}
        </p>
      )}

      {error && (
        <p className="st-sign-error" role="alert">
          {error}
        </p>
      )}

      <button
        className={`st-primary${flagged ? " st-primary-warn" : ""}`}
        type="submit"
        disabled={submitting || !correctiveOk}
      >
        {submitting
          ? "Saving…"
          : flagged
            ? "Submit with corrective action"
            : "Submit log"}
      </button>

      {flagged && !correctiveOk && (
        <p className="st-log-hint">
          {corrective.trim().length === 0
            ? "Say what you did about it before this can be filed."
            : `A few more words — ${correctiveLeft} more ${
                correctiveLeft === 1 ? "character" : "characters"
              }. What was actually done, so somebody reading this in three years knows.`}
        </p>
      )}
    </form>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  autoFocus,
  flagged,
  missing,
}: {
  field: Field;
  value: Answers[string];
  onChange: (v: Answers[string]) => void;
  autoFocus: boolean;
  flagged: boolean;
  missing: boolean;
}) {
  const cls = `st-log-row${flagged ? " st-log-row-flag" : ""}${
    missing ? " st-log-row-missing" : ""
  }`;

  return (
    <div className={cls}>
      <div className="st-log-label">
        <span>{field.label}</span>
        {field.type === "number" && (field.min !== undefined || field.max !== undefined) && (
          <span className="st-log-range">
            {field.min !== undefined && field.max !== undefined
              ? `${field.min}–${field.max}`
              : field.min !== undefined
                ? `≥ ${field.min}`
                : `≤ ${field.max}`}
            {field.unit ? ` ${field.unit}` : ""}
          </span>
        )}
      </div>

      <div className="st-log-input">
        {field.type === "number" && (
          <div className="st-num-wrap">
            <input
              data-field={field.id}
              className="st-input st-input-num"
              type="number"
              // Brings up a keypad with a decimal point on a phone rather
              // than the full keyboard.
              inputMode="decimal"
              step={field.step ?? "any"}
              value={value === null || value === undefined ? "" : String(value)}
              onChange={(e) =>
                onChange(e.target.value === "" ? null : Number(e.target.value))
              }
              autoFocus={autoFocus}
            />
            {field.unit && <span className="st-num-unit">{field.unit}</span>}
          </div>
        )}

        {field.type === "text" && (
          <input
            data-field={field.id}
            className="st-input"
            type="text"
            value={value === null || value === undefined ? "" : String(value)}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            autoFocus={autoFocus}
          />
        )}

        {field.type === "date" && (
          <input
            data-field={field.id}
            className="st-input st-input-date"
            type="date"
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
            autoFocus={autoFocus}
          />
        )}

        {field.type === "boolean" && (
          <div className="st-toggle" role="group" aria-label={field.label}>
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                data-field={v ? field.id : undefined}
                className={`st-toggle-btn${value === v ? " st-toggle-on" : ""}`}
                aria-pressed={value === v}
                onClick={() => onChange(v)}
              >
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
        )}

        {field.type === "select" &&
          // Four or fewer options become buttons — one tap instead of the
          // open-then-choose a native select costs. More than that and the
          // buttons stop fitting, so it goes back to a select.
          (field.options.length <= 4 ? (
            <div className="st-toggle st-toggle-wide" role="group" aria-label={field.label}>
              {field.options.map((o, i) => (
                <button
                  key={o}
                  type="button"
                  data-field={i === 0 ? field.id : undefined}
                  className={`st-toggle-btn${value === o ? " st-toggle-on" : ""}`}
                  aria-pressed={value === o}
                  onClick={() => onChange(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <select
              data-field={field.id}
              className="st-input st-select"
              value={value === null || value === undefined ? "" : String(value)}
              onChange={(e) => onChange(e.target.value)}
              autoFocus={autoFocus}
            >
              <option value="">Choose…</option>
              {field.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ))}

        {field.help && <p className="st-log-help">{field.help}</p>}
      </div>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";

// Signing one policy document: the attestation sentence, a typed legal
// name, and a drawn signature.
//
// Both are collected on purpose. The typed name is what makes the record
// legible and searchable; the drawn mark is what people recognise as
// signing and what makes the act feel deliberate rather than like
// dismissing a dialog. Under E-SIGN either can qualify — the one that
// matters legally is the intent, which is why the button is not enabled
// until the person has actually done both.

const VIEW_W = 520;
const VIEW_H = 150;

export default function SignatureForm({
  docId,
  attestation,
  defaultName,
  remaining,
}: {
  docId: string;
  attestation: string;
  defaultName: string;
  remaining: number;
}) {
  const [typedName, setTypedName] = useState(defaultName);
  const [agreed, setAgreed] = useState(false);
  const [hasMark, setHasMark] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const inkRef = useRef<SVGPathElement>(null);

  // The stroke lives in a ref and is written straight to the path element,
  // NOT in React state.
  //
  // Two reasons, and the first one is a bug I had to fix rather than a
  // preference: a pointermove handler that reads state written by the
  // pointerdown handler reads the value from its own render, so with
  // events arriving faster than React commits, the first moves saw a null
  // stroke and were dropped — sometimes losing the whole signature. The
  // second is that re-rendering a component on every pointer sample is a
  // lot of work per pixel on the phone this will mostly be signed on.
  const strokes = useRef<string[]>([]);
  const drawing = useRef(false);

  function paint() {
    if (inkRef.current) inkRef.current.setAttribute("d", strokes.current.join(" "));
  }

  // Pointer events rather than mouse+touch: one code path covers a mouse,
  // a finger on a phone, and a stylus on a tablet, which is what most of
  // these will actually be signed with.
  function point(e: React.PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  const ready = agreed && typedName.trim().length >= 2 && hasMark && !submitting;

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/staff/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        docId,
        typedName: typedName.trim(),
        signaturePath: strokes.current.join(" "),
      }),
    }).catch(() => null);

    if (!res?.ok) {
      setSubmitting(false);
      setError(
        res?.status === 409
          ? "You have already signed this document."
          : "That didn't save. Check your connection and try again — nothing was recorded."
      );
      return;
    }

    // Full navigation, not a client-side push: the server recomputes what
    // is outstanding and decides the next step. No progress state lives in
    // the browser, so a refresh or a back button can't desynchronize it.
    window.location.assign("/staff/onboarding");
  }

  return (
    <div className="st-sign">
      <p className="st-sign-statement">{attestation}</p>

      <label className="st-check">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>I have read this document in full and I agree to the statement above.</span>
      </label>

      <label className="st-field">
        <span className="st-field-label">Your full legal name</span>
        <input
          className="st-input"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="e.g. Kathryn A. Nguyen"
          autoComplete="name"
        />
      </label>

      <div className="st-field">
        <span className="st-field-label">
          Sign below
          {hasMark && (
            <button
              type="button"
              className="st-clear"
              onClick={() => {
                strokes.current = [];
                drawing.current = false;
                paint();
                setHasMark(false);
              }}
            >
              Clear
            </button>
          )}
        </span>
        <svg
          ref={svgRef}
          className="st-pad"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label="Signature area — draw your signature here"
          onPointerDown={(e) => {
            // Capture keeps the stroke alive when a finger slides past
            // the edge of the pad. It is an improvement, not a
            // requirement, and the spec allows it to throw
            // (InvalidPointerId, for a pointer the browser doesn't
            // consider active). An exception here would abort the rest of
            // this handler and produce a silently empty signature, so it
            // fails soft and drawing continues without capture.
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* no capture; the stroke just ends at the edge */
            }
            drawing.current = true;
            strokes.current.push(`M ${point(e)}`);
            paint();
            if (!hasMark) setHasMark(true);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            strokes.current[strokes.current.length - 1] += ` L ${point(e)}`;
            paint();
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
          onPointerCancel={() => {
            // A phone call, a notification, a palm rejection event — the
            // stroke ends where it ended rather than continuing from
            // wherever the finger reappears.
            drawing.current = false;
          }}
        >
          <line
            className="st-pad-rule"
            x1="24"
            y1={VIEW_H - 34}
            x2={VIEW_W - 24}
            y2={VIEW_H - 34}
          />
          {/* Deliberately no `d` prop: paint() is the only writer. React
              leaves an unchanged prop alone, so a static d="" would not
              actually clobber the stroke today — but two owners for one
              attribute is the kind of thing that starts clobbering it
              after an unrelated refactor. */}
          <path ref={inkRef} className="st-pad-ink" />
        </svg>
        {!hasMark && <p className="st-pad-hint">Use your finger, stylus, or mouse.</p>}
      </div>

      {error && (
        <p className="st-sign-error" role="alert">
          {error}
        </p>
      )}

      <button className="st-primary" onClick={submit} disabled={!ready}>
        {submitting
          ? "Saving…"
          : remaining > 1
            ? "Sign and continue"
            : "Sign and finish"}
      </button>

      <p className="st-sign-fine">
        Your signature is recorded with the date, time, and a fingerprint of
        this document&rsquo;s exact text. It cannot be edited or deleted
        afterwards — by you or by anyone else.
      </p>
    </div>
  );
}

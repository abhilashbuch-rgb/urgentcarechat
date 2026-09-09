"use client";

import { useRef, useState } from "react";
import { loadBitmap } from "@/lib/staff/image";
import PhotoCrop from "@/app/components/staff/PhotoCrop";

// Photograph a digital thermometer, crop to just the display, and let a
// vision model propose the number — as a SUGGESTION, never a save.
//
// THE ONLY THING THIS COMPONENT DOES IS PROPOSE A NUMBER. It never
// writes to the log. onRead fills the same number input a preset chip
// or the keyboard would, and the person still has to look at it and
// either leave it or retype it before anything is submitted. See
// app/api/staff/logs/read-digits/route.ts, which persists nothing
// either — the record of what was actually confirmed lives entirely in
// the normal submit path.
//
// THIS IS A SEPARATE CAPTURE FROM CameraProof's evidence photo, not the
// same photo reused. Keeping them independent is what makes "only a
// tight crop of the display ever reaches the vision API" true by
// construction — the evidence photo (full frame) is never sent
// anywhere but the compliance-media bucket, and this crop is never
// stored anywhere at all, just discarded after the read.

export type Confidence = "high" | "low";

type Stage = "idle" | "cropping" | "sending";

export default function AiPhotoRead({
  onRead,
  disabled,
}: {
  onRead: (value: number, confidence: "high", model: string) => void;
  disabled?: boolean;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [bitmap, setBitmap] = useState<ImageBitmap | HTMLImageElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    setNotice(null);
    try {
      const bmp = await loadBitmap(file);
      setBitmap(bmp);
      setStage("cropping");
    } catch {
      setNotice("That photo didn't process. Try again, or just type the reading.");
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function cancelCrop() {
    setBitmap(null);
    setStage("idle");
  }

  async function sendCrop(blob: Blob) {
    setStage("sending");
    setNotice(null);
    try {
      const fd = new FormData();
      fd.set("image", new File([blob], "crop.jpg", { type: blob.type }));
      const res = await fetch("/api/staff/logs/read-digits", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.ok) {
        setNotice("Couldn't reach the reader — type the number in instead.");
      } else if (body.value === null || body.confidence !== "high") {
        setNotice("Couldn't read that clearly — try again, or just type it in.");
      } else {
        onRead(body.value as number, "high", body.model ?? "claude");
        setNotice(`Read ${body.value} from the photo — check the display, then confirm below.`);
      }
    } catch {
      setNotice("Couldn't reach the reader — type the number in instead.");
    }
    setBitmap(null);
    setStage("idle");
  }

  return (
    <div className="st-ai-read">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        hidden
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />

      {stage === "cropping" && bitmap ? (
        <PhotoCrop bitmap={bitmap} onConfirm={sendCrop} onCancel={cancelCrop} />
      ) : (
        <button
          type="button"
          className="st-btn st-btn-quiet st-ai-read-btn"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || stage === "sending"}
        >
          {stage === "sending" ? "Reading…" : "Read from photo"}
        </button>
      )}

      {notice && (
        <p className="st-field-hint" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

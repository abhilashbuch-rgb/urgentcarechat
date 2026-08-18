"use client";

import { useRef, useState } from "react";

// Photo proof for a shift log: the NIST display, the crash cart seal,
// the POCT read window.
//
// DOWNSAMPLED IN THE BROWSER BEFORE IT IS SENT. A modern phone camera
// produces a 48MP, 12MB JPEG. Uploading that over clinic wifi from a
// back corridor is how a fifteen-second log becomes a two-minute one,
// and iOS Safari will happily run out of memory decoding several of
// them. Canvas re-encoding at 1600x1200 / 0.8 also strips EXIF, which
// is where the phone writes the GPS tag.
//
// THE DISCLAIMER IS PERSISTENT, NOT A ONE-TIME MODAL. It is visible
// every time the control is used, because the risk is not that somebody
// never knew — it is that they are in a hurry and the chart is in shot.
//
// capture="environment" asks for the rear camera directly, so the
// common case is one tap rather than a trip through the photo library
// where the last thing photographed might be anything.

const MAX_W = 1600;
const MAX_H = 1200;
const QUALITY = 0.8;

export interface Proof {
  blob: Blob;
  previewUrl: string;
  bytes: number;
}

export default function CameraProof({
  label,
  onChange,
  disabled,
}: {
  label: string;
  onChange: (p: Proof | null) => void;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function take(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const shrunk = await downsample(file);
      const url = URL.createObjectURL(shrunk);
      setPreview(url);
      setSize(shrunk.size);
      onChange({ blob: shrunk, previewUrl: url, bytes: shrunk.size });
    } catch {
      setError("That photo didn't process. Try taking it again.");
      onChange(null);
    }
    setBusy(false);
  }

  function clear() {
    setPreview(null);
    setSize(null);
    setError(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="st-proof">
      <span className="st-field-label">{label}</span>

      {/* Said every time, not once at onboarding. */}
      <p className="st-proof-warn">
        Capture the equipment screen or seal tag <strong>only</strong>. No
        patient faces, charts, wristbands or screens in shot.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={disabled}
        onChange={(e) => take(e.target.files?.[0] ?? null)}
      />

      {preview ? (
        <div className="st-proof-shot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="st-proof-img" />
          <div className="st-proof-actions">
            <span className="st-proof-size">
              {size ? `${Math.round(size / 1024)} KB` : ""}
            </span>
            <button type="button" className="st-btn st-btn-quiet" onClick={clear}>
              Remove
            </button>
            <button
              type="button"
              className="st-btn"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
            >
              Retake
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="st-btn"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
        >
          {busy ? "Processing…" : "Take photo"}
        </button>
      )}

      {error && (
        <p className="st-run-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Re-encode to at most 1600x1200 JPEG at 0.8.
 *
 * createImageBitmap where available — it decodes off the main thread,
 * which on a mid-range Android is the difference between a responsive
 * button and a frozen one. The <img> path is the fallback for Safari
 * versions that lack it.
 */
async function downsample(file: File): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_W / bitmap.width, MAX_H / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
      "image/jpeg",
      QUALITY
    )
  );
}

async function loadBitmap(
  file: File
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Falls through to the <img> path.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    // Revoked after the image has loaded; the canvas holds the pixels.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

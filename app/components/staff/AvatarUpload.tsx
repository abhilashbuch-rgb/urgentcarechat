"use client";

import { useRef, useState } from "react";

// Choose a photo, frame it, upload the square.
//
// THE CROP HAPPENS IN THE BROWSER AND ONLY THE SQUARE IS SENT. That is
// not a bandwidth optimisation, it is the privacy design: an uncropped
// original — which on a phone is whatever the camera roll had in frame,
// with EXIF GPS attached — never leaves the device. What the server
// receives is a 512x512 WebP re-encoded by canvas, which also strips
// every metadata block the original carried.
//
// NO FACE DETECTION, DELIBERATELY. See the header of
// supabase/staff-avatars.sql: running face detection over employee
// photographs generates a biometric identifier, which BIPA and CUBI
// regulate with notice-and-consent requirements a clinic switching this
// on would not know it had triggered. The rules are stated in words to
// the person instead, which is what a twenty-person clinic actually
// needs.

const OUT = 512;

const ERRORS: Record<string, string> = {
  uploads_not_enabled:
    "Photo uploads aren't switched on for this clinic yet. Your initials will show until they are.",
  file_too_large: "That image is too big even after cropping. Try another.",
  bad_file_type: "JPEG, PNG, WebP or HEIC.",
  upload_failed: "That didn't upload. Try once more.",
};

export default function AvatarUpload({
  currentSrc,
  brandColor,
}: {
  currentSrc: string | null;
  brandColor: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(file: File | null) {
    if (!file) return;
    setError(null);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setPreview(url);
      setZoom(1);
    };
    image.onerror = () => {
      setError("That file didn't open as an image.");
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }

  /** Centre-crop to a square at the chosen zoom, re-encoded as WebP. */
  async function cropped(): Promise<Blob | null> {
    if (!img) return null;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // The largest square that fits, divided by zoom, centred.
    const side = Math.min(img.width, img.height) / zoom;
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;

    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, side, side, 0, 0, OUT, OUT);

    return new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", 0.88)
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const blob = await cropped();
    if (!blob) {
      setError("That didn't crop. Try a different image.");
      setBusy(false);
      return;
    }

    const form = new FormData();
    form.set("file", new File([blob], "avatar.webp", { type: "image/webp" }));

    const res = await fetch("/api/staff/avatar", {
      method: "POST",
      body: form,
    }).catch(() => null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(ERRORS[body?.error] ?? "That didn't save. Try once more.");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  async function remove() {
    setBusy(true);
    const res = await fetch("/api/staff/avatar", { method: "DELETE" }).catch(
      () => null
    );
    if (res?.ok) window.location.reload();
    else {
      setError("That didn't remove. Try once more.");
      setBusy(false);
    }
  }

  return (
    <div className="st-avatar-upload">
      <div className="st-avatar-stage">
        <span
          className="st-avatar st-avatar-lg"
          style={{ boxShadow: `inset 0 0 0 4px ${brandColor}` }}
        >
          {preview ? (
            // The live frame: the same circular mask the app renders, so
            // what you see here is exactly what everyone else will see.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="st-avatar-img"
              src={preview}
              alt=""
              style={{ transform: `scale(${zoom})` }}
            />
          ) : currentSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="st-avatar-img" src={currentSrc} alt="" />
          ) : (
            <span className="st-avatar-empty" aria-hidden="true">
              No photo
            </span>
          )}
        </span>

        {preview && (
          <label className="st-field">
            <span className="st-field-label">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        hidden
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />

      <p className="st-field-hint">
        Your face, looking at the camera. Not a logo, not a group photo, not a
        picture with text on it. Your colleagues need to recognise you from it.
      </p>

      {error && (
        <p className="st-run-error" role="alert">
          {error}
        </p>
      )}

      <div className="st-run-actions">
        {currentSrc && !preview && (
          <button className="st-btn" onClick={remove} disabled={busy}>
            Remove
          </button>
        )}
        {preview && (
          <button
            className="st-btn"
            onClick={() => {
              setPreview(null);
              setImg(null);
            }}
            disabled={busy}
          >
            Cancel
          </button>
        )}
        <button
          className={preview ? "st-btn" : "st-btn st-btn-primary"}
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {currentSrc || preview ? "Choose another" : "Choose a photo"}
        </button>
        {preview && (
          <button
            className="st-btn st-btn-primary"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Saving…" : "Save photo"}
          </button>
        )}
      </div>
    </div>
  );
}

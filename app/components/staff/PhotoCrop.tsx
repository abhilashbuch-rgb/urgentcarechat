"use client";

import { useEffect, useRef, useState } from "react";

// Drag a box over a just-taken photo, then crop to exactly that.
//
// WHY A CROP STEP AND NOT A CAPTURE-TIME GUIDE. This PWA has no live
// camera preview anywhere (capture is the native-camera-app-via-file-
// input pattern in CameraProof.tsx) — there is no live frame to draw a
// guide over. The only image the page ever controls is the still photo
// handed back after the native app closes, so "only send the display"
// can only be enforced here, on that still photo, not at capture time.
//
// OUTPUT IS CAPPED SMALL ON PURPOSE. A thermometer's digit display never
// needs more than a few hundred pixels a side to read reliably, and a
// small image is also a cheap one to send.

const OUT_MAX = 800;
const HANDLE_HIT = 26; // px, generous for a thumb

type Rect = { x: number; y: number; w: number; h: number };
type Corner = "nw" | "ne" | "sw" | "se";

export default function PhotoCrop({
  bitmap,
  onConfirm,
  onCancel,
}: {
  bitmap: ImageBitmap | HTMLImageElement;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const dragRef = useRef<{ mode: "move" | Corner; startX: number; startY: number; orig: Rect } | null>(null);
  const [busy, setBusy] = useState(false);

  const srcW = "width" in bitmap ? bitmap.width : 0;
  const srcH = "height" in bitmap ? bitmap.height : 0;

  // Size the canvas to fit the available width, then draw once.
  useEffect(() => {
    const wrapWidth = wrapRef.current?.clientWidth || 360;
    const maxW = Math.min(wrapWidth, 480);
    const scale = Math.min(1, maxW / srcW);
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    setDisplay({ w, h });

    // Start the box over the central 60% of the frame — the common case
    // for a thermometer held roughly centered in shot.
    setRect({ x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 });

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bitmap]);

  function clampRect(r: Rect, w: number, h: number): Rect {
    const minSize = 40;
    let { x, y, w: rw, h: rh } = r;
    rw = Math.max(minSize, Math.min(rw, w));
    rh = Math.max(minSize, Math.min(rh, h));
    x = Math.max(0, Math.min(x, w - rw));
    y = Math.max(0, Math.min(y, h - rh));
    return { x, y, w: rw, h: rh };
  }

  function pointerPos(e: React.PointerEvent): { x: number; y: number } {
    const box = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  // One stable handler for both the box and the four corner handles,
  // reading which one from a data attribute rather than currying a mode
  // into a per-element closure — so this function is the thing passed
  // to onPointerDown, not something built fresh by calling another
  // function during render.
  function onDragStart(e: React.PointerEvent<HTMLDivElement>) {
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    const mode = (e.currentTarget.dataset.mode as "move" | Corner) ?? "move";
    const p = pointerPos(e);
    dragRef.current = { mode, startX: p.x, startY: p.y, orig: rect };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !display) return;
    const p = pointerPos(e);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    const { orig } = drag;

    let next: Rect;
    if (drag.mode === "move") {
      next = { ...orig, x: orig.x + dx, y: orig.y + dy };
    } else {
      let { x, y, w, h } = orig;
      if (drag.mode === "nw") { x += dx; y += dy; w -= dx; h -= dy; }
      if (drag.mode === "ne") { y += dy; w += dx; h -= dy; }
      if (drag.mode === "sw") { x += dx; w -= dx; h += dy; }
      if (drag.mode === "se") { w += dx; h += dy; }
      next = { x, y, w, h };
    }
    setRect(clampRect(next, display.w, display.h));
  }

  function endDrag() {
    dragRef.current = null;
  }

  async function confirm() {
    if (!rect || !display) return;
    setBusy(true);
    try {
      // Map the on-screen rect back to source-image pixels.
      const scale = srcW / display.w;
      const sx = Math.round(rect.x * scale);
      const sy = Math.round(rect.y * scale);
      const sw = Math.round(rect.w * scale);
      const sh = Math.round(rect.h * scale);

      const outScale = Math.min(1, OUT_MAX / sw, OUT_MAX / sh);
      const ow = Math.max(1, Math.round(sw * outScale));
      const oh = Math.max(1, Math.round(sh * outScale));

      const out = document.createElement("canvas");
      out.width = ow;
      out.height = oh;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, ow, oh);

      const blob = await new Promise<Blob>((resolve, reject) =>
        out.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
          "image/jpeg",
          0.85
        )
      );
      onConfirm(blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-crop">
      <p className="st-proof-warn">
        Drag the box over the display only — just the box is sent for
        reading, nothing else in the photo.
      </p>
      <div
        ref={wrapRef}
        className="st-crop-wrap"
        style={display ? { width: display.w, height: display.h } : undefined}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <canvas ref={canvasRef} className="st-crop-canvas" />
        {rect && (
          <>
            <div
              className="st-crop-box"
              data-mode="move"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              onPointerDown={onDragStart}
            />
            {(["nw", "ne", "sw", "se"] as Corner[]).map((c) => (
              <div
                key={c}
                className={`st-crop-handle st-crop-handle-${c}`}
                data-mode={c}
                style={{
                  left: c.includes("w") ? rect.x : rect.x + rect.w,
                  top: c.includes("n") ? rect.y : rect.y + rect.h,
                  width: HANDLE_HIT,
                  height: HANDLE_HIT,
                }}
                onPointerDown={onDragStart}
              />
            ))}
          </>
        )}
      </div>
      <div className="st-proof-actions">
        <button type="button" className="st-btn st-btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="st-btn" onClick={confirm} disabled={busy || !rect}>
          {busy ? "Cropping…" : "Use this crop"}
        </button>
      </div>
    </div>
  );
}

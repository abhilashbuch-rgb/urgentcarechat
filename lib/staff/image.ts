// Shared browser-side image decode/resize helpers.
//
// Pulled out of CameraProof.tsx so a second capture component (the
// AI-read crop flow in AiPhotoRead.tsx) doesn't grow its own copy of
// "decode a File into something a canvas can draw." Behavior is
// unchanged from where it lived before.

/**
 * Decode a File into something a canvas can draw.
 *
 * createImageBitmap where available — it decodes off the main thread,
 * which on a mid-range Android is the difference between a responsive
 * button and a frozen one. The <img> path is the fallback for Safari
 * versions that lack it.
 */
export async function loadBitmap(
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

/**
 * Re-encode a decoded image to at most maxW x maxH, as JPEG at the given
 * quality. Also strips EXIF (including any GPS tag), since re-encoding
 * through canvas never carries metadata forward.
 */
export async function downsampleBitmap(
  bitmap: ImageBitmap | HTMLImageElement,
  maxW: number,
  maxH: number,
  quality: number
): Promise<Blob> {
  const width = "width" in bitmap ? bitmap.width : 0;
  const height = "height" in bitmap ? bitmap.height : 0;
  const scale = Math.min(1, maxW / width, maxH / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

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
      quality
    )
  );
}

/** Decode-then-resize in one call, the common case for a fresh capture. */
export async function downsample(
  file: File,
  maxW: number,
  maxH: number,
  quality: number
): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  return downsampleBitmap(bitmap, maxW, maxH, quality);
}

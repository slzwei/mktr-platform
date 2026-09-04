/**
 * Client-side image optimisation for the RSVP designer.
 *
 * An event page is mostly one big picture, and the picture people upload is a
 * phone photo: 4000px wide, 6MB, JPEG. Shipping that to a mobile browser on a
 * bus is the whole page-weight budget spent on one hero. We downscale to a
 * sensible edge and re-encode to WebP in the browser BEFORE the upload, so the
 * bytes that reach the server are already the bytes we want to serve. That
 * also makes the upload itself fast on a phone.
 *
 * Everything degrades to "hand back the original file": an animated GIF (which
 * a canvas round-trip would freeze to one frame), a browser without
 * createImageBitmap or canvas encoding, a decode failure, or a re-encode that
 * came out no smaller. The caller never has to care — it always gets a File.
 */

/** Longest edge we keep. 1600 covers a retina phone hero and a desktop card. */
export const MAX_EDGE = 1600;
/** WebP quality. 0.82 is visually clean on photos and roughly a third of JPEG q90. */
export const WEBP_QUALITY = 0.82;
/** Below this, a small already-web-sized file is left exactly as it is. */
export const SKIP_UNDER_BYTES = 150 * 1024;

/** Fit (w, h) inside maxEdge, preserving aspect. */
export function targetSize(w, h, maxEdge = MAX_EDGE) {
  const width = Math.max(1, Math.round(w || 0));
  const height = Math.max(1, Math.round(h || 0));
  const longest = Math.max(width, height);
  if (!longest || longest <= maxEdge) return { width, height, scaled: false };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: true };
}

const baseName = (name) => String(name || 'image').replace(/\.[^./\\]*$/, '') || 'image';

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      if (typeof canvas.toBlob !== 'function') return resolve(null);
      canvas.toBlob((blob) => resolve(blob || null), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** Human-readable size, for the designer's "1.2MB → 180KB" line. */
export function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Returns { file, skipped?, width?, height?, bytesBefore?, bytesAfter? }.
 * `file` is ALWAYS a usable File — the original when we could not do better.
 */
export async function optimizeImageFile(file, { maxEdge = MAX_EDGE, quality = WEBP_QUALITY } = {}) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
    return { file, skipped: 'not-an-image' };
  }
  // An animated GIF survives a canvas round-trip as a single frozen frame.
  if (file.type === 'image/gif') return { file, skipped: 'animated-safe' };
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { file, skipped: 'unsupported-browser' };
  }

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // A CMYK JPEG or a corrupt file: let the server decide, do not block the upload.
    return { file, skipped: 'decode-failed' };
  }

  try {
    const { width, height, scaled } = targetSize(bitmap.width, bitmap.height, maxEdge);
    if (!scaled && file.size <= SKIP_UNDER_BYTES) {
      return { file, width, height, skipped: 'already-small' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) return { file, width, height, skipped: 'no-canvas' };
    ctx.drawImage(bitmap, 0, 0, width, height);

    // A browser without WebP encoding silently hands back a PNG — which is
    // usually BIGGER than the JPEG we started with, so check the type, not just
    // the blob, and fall back to JPEG rather than shipping a bloated PNG.
    let blob = await canvasToBlob(canvas, 'image/webp', quality);
    if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (!blob || (blob.type !== 'image/webp' && blob.type !== 'image/jpeg')) {
      return { file, width, height, skipped: 'encode-failed' };
    }
    if (blob.size >= file.size) return { file, width, height, skipped: 'no-gain' };

    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const out = new File([blob], `${baseName(file.name)}.${ext}`, { type: blob.type, lastModified: Date.now() });
    // Report the ENCODED blob's size: it is the payload we are about to send.
    return { file: out, width, height, bytesBefore: file.size, bytesAfter: blob.size };
  } finally {
    bitmap?.close?.();
  }
}

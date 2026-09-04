/**
 * The optimiser must ALWAYS hand back a usable File. These cover the happy
 * path (downscale + WebP), every degradation, and the "do not make it worse"
 * guards.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { optimizeImageFile, targetSize, formatBytes, MAX_EDGE, SKIP_UNDER_BYTES } from '../imageOptimize';

const fileOf = (name, type, size) => {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

/** Stub createImageBitmap + a canvas whose toBlob yields `blobs` in order. */
function stubBrowser({ w, h, blobs }) {
  const close = vi.fn();
  globalThis.createImageBitmap = vi.fn(async () => ({ width: w, height: h, close }));
  const queue = [...blobs];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (cb) => cb(queue.shift() ?? null),
  };
  vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : document.createElement.wrappedMethod?.(tag)));
  return { canvas, close };
}

const blob = (type, size) => {
  const b = new Blob([new Uint8Array(1)], { type });
  Object.defineProperty(b, 'size', { value: size });
  return b;
};

afterEach(() => { vi.restoreAllMocks(); delete globalThis.createImageBitmap; });

describe('targetSize', () => {
  it('leaves anything within the edge alone, and fits the rest preserving aspect', () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(targetSize(4000, 3000)).toEqual({ width: 1600, height: 1200, scaled: true });
    expect(targetSize(3000, 4000)).toEqual({ width: 1200, height: 1600, scaled: true });
    expect(targetSize(MAX_EDGE, 10)).toEqual({ width: MAX_EDGE, height: 10, scaled: false });
    expect(targetSize(0, 0).width).toBe(1);
  });
});

describe('formatBytes', () => {
  it('reads like a person wrote it', () => {
    expect(formatBytes(900)).toBe('900B');
    expect(formatBytes(180 * 1024)).toBe('180KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4MB');
  });
});

describe('optimizeImageFile', () => {
  it('downscales a phone photo and re-encodes it to WebP', async () => {
    const { canvas, close } = stubBrowser({ w: 4032, h: 3024, blobs: [blob('image/webp', 180 * 1024)] });
    const src = fileOf('IMG_4821.HEIC.jpg', 'image/jpeg', 6 * 1024 * 1024);
    const out = await optimizeImageFile(src);

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(out.file.name).toBe('IMG_4821.HEIC.webp');
    expect(out.file.type).toBe('image/webp');
    expect(out.bytesBefore).toBe(6 * 1024 * 1024);
    expect(out.bytesAfter).toBe(180 * 1024);
    expect(out.skipped).toBeUndefined();
    expect(close).toHaveBeenCalled();
  });

  it('falls back to JPEG when the browser cannot encode WebP (it returns a PNG)', async () => {
    stubBrowser({ w: 2000, h: 1000, blobs: [blob('image/png', 900 * 1024), blob('image/jpeg', 120 * 1024)] });
    const out = await optimizeImageFile(fileOf('poster.png', 'image/png', 2 * 1024 * 1024));
    expect(out.file.type).toBe('image/jpeg');
    expect(out.file.name).toBe('poster.jpg');
    expect(out.bytesAfter).toBe(120 * 1024);
  });

  it('keeps the original when re-encoding would not save anything', async () => {
    stubBrowser({ w: 1200, h: 800, blobs: [blob('image/webp', 999 * 1024)] });
    const src = fileOf('already-tuned.webp', 'image/webp', 300 * 1024);
    const out = await optimizeImageFile(src);
    expect(out.file).toBe(src);
    expect(out.skipped).toBe('no-gain');
  });

  it('leaves a small, correctly sized picture exactly as it is', async () => {
    stubBrowser({ w: 900, h: 600, blobs: [] });
    const src = fileOf('logo.png', 'image/png', SKIP_UNDER_BYTES - 1);
    const out = await optimizeImageFile(src);
    expect(out.file).toBe(src);
    expect(out.skipped).toBe('already-small');
  });

  it('never freezes an animated GIF, and passes non-images straight through', async () => {
    const gif = fileOf('party.gif', 'image/gif', 4 * 1024 * 1024);
    expect((await optimizeImageFile(gif)).file).toBe(gif);
    expect((await optimizeImageFile(gif)).skipped).toBe('animated-safe');
    const pdf = fileOf('deck.pdf', 'application/pdf', 10);
    expect((await optimizeImageFile(pdf)).skipped).toBe('not-an-image');
  });

  it('degrades to the original when the browser lacks the APIs or the decode fails', async () => {
    const src = fileOf('x.jpg', 'image/jpeg', 5 * 1024 * 1024);
    expect((await optimizeImageFile(src)).skipped).toBe('unsupported-browser');

    globalThis.createImageBitmap = vi.fn(async () => { throw new Error('cmyk'); });
    const out = await optimizeImageFile(src);
    expect(out.file).toBe(src);
    expect(out.skipped).toBe('decode-failed');
  });

  it('degrades when encoding produces nothing at all', async () => {
    stubBrowser({ w: 3000, h: 2000, blobs: [null, null] });
    const src = fileOf('big.jpg', 'image/jpeg', 5 * 1024 * 1024);
    const out = await optimizeImageFile(src);
    expect(out.file).toBe(src);
    expect(out.skipped).toBe('encode-failed');
  });
});

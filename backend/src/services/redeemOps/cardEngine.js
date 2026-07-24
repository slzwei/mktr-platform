import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared satori/resvg engine for the consumer card compositors — the Editorial
 * voucher card (qrCardRenderer.js) and the Vault lucky-draw pass
 * (drawPassRenderer.js). Both draw from ONE lazily-loaded font cache: the seven
 * TTFs are ~1.5MB and a per-renderer copy would double that for no reason.
 *
 * Text is rendered to paths with the bundled fonts, so nothing here depends on
 * a system font being installed on the Render box. Callers treat any throw as
 * "fall back to the bare QR (or no image at all)" — a broken native dep must
 * degrade delivery QUALITY, never delivery itself.
 */

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');

let enginePromise = null;

/** @returns {Promise<{satori: Function, Resvg: Function, fonts: Array}>} */
export async function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [{ default: satori }, { Resvg }] = await Promise.all([
        import('satori'),
        import('@resvg/resvg-js'),
      ]);
      const font = (file) => readFile(path.join(FONT_DIR, file));
      const fonts = [
        { name: 'Fraunces', data: await font('fraunces-600.ttf'), weight: 600, style: 'normal' },
        { name: 'Fraunces', data: await font('fraunces-italic-400.ttf'), weight: 400, style: 'italic' },
        { name: 'Fraunces', data: await font('fraunces-italic-600.ttf'), weight: 600, style: 'italic' },
        { name: 'Albert Sans', data: await font('albertsans-400.ttf'), weight: 400, style: 'normal' },
        { name: 'Albert Sans', data: await font('albertsans-600.ttf'), weight: 600, style: 'normal' },
        { name: 'Albert Sans', data: await font('albertsans-800.ttf'), weight: 800, style: 'normal' },
        { name: 'JetBrains Mono', data: await font('jetbrainsmono-600.ttf'), weight: 600, style: 'normal' },
      ];
      return { satori, Resvg, fonts };
    })();
    // A transient failure (e.g. fonts unreadable mid-deploy) must not poison the cache.
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

export const el = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });
export const txt = (style, text) => ({ type: 'div', props: { style, children: text } });

/** Meta/WhatsApp-safe single-line text: collapse whitespace, cap length. */
export function clean(value, max, fallback = '') {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || fallback;
}

/** Renders a satori element tree to a PNG buffer at the given square size. */
export async function renderSquarePng(tree, size, { satori, Resvg, fonts }) {
  const svg = await satori(tree, { width: size, height: size, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
  return Buffer.from(png);
}

export default { loadEngine, el, txt, clean, renderSquarePng };

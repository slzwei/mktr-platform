/**
 * Pick a legible text color for a given background color.
 *
 * Keeps white (the brand default on accent buttons) UNLESS white would be
 * clearly illegible on a light background — then it falls back to dark ink.
 * This is a contrast FLOOR for operator-chosen campaign theme colors: a pale
 * `themeColor` no longer yields unreadable white-on-light buttons, while the
 * default terracotta / sage accents keep their white text.
 *
 * Uses the WCAG relative-luminance + contrast-ratio formulas.
 */

function luminance(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const lin = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
}

const contrastRatio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

// Below this white-on-background ratio, switch to dark ink. 3.0 keeps white on
// the brand terracotta/sage accents but flips pale custom themes to dark text.
const WHITE_FLOOR = 3;

export function readableTextOn(bgHex, dark = '#3D1F0B', light = '#ffffff') {
  const bg = luminance(bgHex);
  if (bg == null) return light;
  const whiteL = luminance(light) ?? 1;
  return contrastRatio(bg, whiteL) >= WHITE_FLOOR ? light : dark;
}

/**
 * WCAG contrast ratio between two hex colors (Studio PR 3 — additive export
 * for the Theme panel's accent-legibility check). Returns null when either
 * color is not a valid hex.
 */
export function colorContrastRatio(hexA, hexB) {
  const a = luminance(hexA);
  const b = luminance(hexB);
  if (a == null || b == null) return null;
  return contrastRatio(a, b);
}

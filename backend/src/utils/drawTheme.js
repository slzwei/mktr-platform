/**
 * The lucky-draw colourway — ONE enum shared by every customer-facing draw
 * surface, so a campaign can never be titanium on WhatsApp and gold in the
 * inbox. Stored as `design_config.luckyDraw.passTheme` (admin-only, clamped by
 * utils/luckyDraw.js) and consumed by:
 *
 *   - services/redeemOps/drawPassRenderer.js — the 1080×1080 "Vault" WhatsApp
 *     card (its own tokens: gradients over a PNG canvas)
 *   - services/email-templates/confirmation-email-draw.html via `emailPalette`
 *     below — the "Onyx" entry-confirmation email
 *
 * The two token sets are deliberately separate — a PNG can lean on rgba and
 * `background-clip:text`, an email cannot — but they are cut from the same
 * four palettes and must stay recognisably the same brand.
 *
 * EMAIL TOKENS ARE SOLID HEX ON PURPOSE. Outlook drops rgba() borders and
 * gradient backgrounds entirely, so every value here is the already-blended
 * colour. There is deliberately no metal GRADIENT among them: the email's hero
 * numeral is `metalSolid`, because a client that keeps -webkit-text-fill-color
 * while stripping background-image would render the whole promise invisible.
 * The clipped-gradient numeral lives on the card, where we own the renderer.
 */

export const PASS_THEMES = ['titanium', 'gold', 'emerald', 'sapphire'];
export const DEFAULT_PASS_THEME = 'titanium';

/** Unknown/absent theme falls back rather than throwing — a bad enum must never cost a send. */
export function resolvePassTheme(name) {
  const key = String(name || '').trim().toLowerCase();
  return PASS_THEMES.includes(key) ? key : DEFAULT_PASS_THEME;
}

const EMAIL_PALETTES = {
  titanium: {
    page: '#08090b',
    panelTop: '#14161a', panelBottom: '#0a0b0d', panelSolid: '#101216',
    border: '#1d2025', hair: '#23262b',
    word: '#f4f5f7', pillText: '#c9ced6', pillBorder: '#3a3e44',
    eyebrow: '#797e86', h1: '#fbfcfd',
    body: '#a9aeb6', bodyStrong: '#eef0f3',
    boxBorder: '#22252a', boxBg: '#111317',
    meterLabel: '#71767e', n1: '#6e737b',
    metalSolid: '#e6e9ee',
    meterSub: '#cfd3d9', meterSubStrong: '#fbfcfd',
    para: '#9ba0a8',
    statKey: '#6e737b', statVal: '#eef0f3',
    dashBorder: '#33373d', linkText: '#dfe3e9',
    btnBorder: '#2c3036', btnText: '#c9ced6', hint: '#6b7078',
    arrowFrom: '#2a2d33', arrowTo: '#6b7078',
    quiet: '#74797f', signItalic: '#9ba0a8', signName: '#eef0f3',
    footBorder: '#1c1f23', footBg: '#0b0c0f', footWord: '#c9ced6', footText: '#6b7078', unsub: '#a9aeb6',
  },
  gold: {
    page: '#0a0805',
    panelTop: '#1d1708', panelBottom: '#0a0a08', panelSolid: '#13100a',
    border: '#2a2312', hair: '#2e2714',
    word: '#f6f2e8', pillText: '#e3c98f', pillBorder: '#4a3f22',
    eyebrow: '#9a8556', h1: '#fdfaf3',
    body: '#ada79a', bodyStrong: '#f2ead9',
    boxBorder: '#2f2814', boxBg: '#17130b',
    meterLabel: '#8d7a4f', n1: '#8a7748',
    metalSolid: '#ecd49a',
    meterSub: '#d6cdb6', meterSubStrong: '#fdfaf3',
    para: '#a09a8c',
    statKey: '#8d7a4f', statVal: '#f2ead9',
    dashBorder: '#453a20', linkText: '#ecdcb9',
    btnBorder: '#3a3119', btnText: '#e0c893', hint: '#857346',
    arrowFrom: '#342c17', arrowTo: '#8d7a4f',
    quiet: '#7c7566', signItalic: '#a09a8c', signName: '#f2ead9',
    footBorder: '#241e10', footBg: '#0d0b07', footWord: '#d3c19a', footText: '#857346', unsub: '#bda870',
  },
  emerald: {
    page: '#050a07',
    panelTop: '#0c1a13', panelBottom: '#060a08', panelSolid: '#0a130e',
    border: '#16281d', hair: '#192c21',
    word: '#eff6f1', pillText: '#a9d6bb', pillBorder: '#2b4636',
    eyebrow: '#6f9781', h1: '#f7fcf8',
    body: '#9fada4', bodyStrong: '#e6f1e9',
    boxBorder: '#1a2e22', boxBg: '#0c1711',
    meterLabel: '#67907a', n1: '#648d77',
    metalSolid: '#cfe6d8',
    meterSub: '#c6d4cb', meterSubStrong: '#f7fcf8',
    para: '#94a29a',
    statKey: '#67907a', statVal: '#e6f1e9',
    dashBorder: '#27412f', linkText: '#d6ebdd',
    btnBorder: '#1f3527', btnText: '#b3d9c1', hint: '#628b74',
    arrowFrom: '#1c3225', arrowTo: '#67907a',
    quiet: '#728177', signItalic: '#94a29a', signName: '#e6f1e9',
    footBorder: '#142418', footBg: '#070d09', footWord: '#b9d5c4', footText: '#628b74', unsub: '#96c2a7',
  },
  sapphire: {
    page: '#06070d',
    panelTop: '#0f1729', panelBottom: '#07090f', panelSolid: '#0c1220',
    border: '#1c2436', hair: '#1e2739',
    word: '#f0f3fa', pillText: '#b7c6e8', pillBorder: '#333f5a',
    eyebrow: '#7d8cb0', h1: '#f8fafd',
    body: '#a2a9bb', bodyStrong: '#e8edf8',
    boxBorder: '#202a3e', boxBg: '#0e1421',
    meterLabel: '#7786ab', n1: '#7484a8',
    metalSolid: '#dbe3f5',
    meterSub: '#c9d0e0', meterSubStrong: '#f8fafd',
    para: '#969db0',
    statKey: '#7786ab', statVal: '#e8edf8',
    dashBorder: '#2d3850', linkText: '#dae2f5',
    btnBorder: '#262f45', btnText: '#bcc9e6', hint: '#71809f',
    arrowFrom: '#242e44', arrowTo: '#7786ab',
    quiet: '#757c8f', signItalic: '#969db0', signName: '#e8edf8',
    footBorder: '#171e2c', footBg: '#080b12', footWord: '#c2cde6', footText: '#71809f', unsub: '#9dadd4',
  },
};

/** Onyx email tokens for a theme, as `{ c_<token>: value }` merge fields. */
export function emailPalette(theme) {
  const p = EMAIL_PALETTES[resolvePassTheme(theme)];
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [`c_${k}`, v]));
}

export default { PASS_THEMES, DEFAULT_PASS_THEME, resolvePassTheme, emailPalette };

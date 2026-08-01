import QRCode from 'qrcode';
import { loadEngine, el, txt, clean, renderSquarePng } from './cardEngine.js';
import { resolvePassTheme } from '../../utils/drawTheme.js';

/**
 * "Vault" lucky-draw pass compositor — the two images of the draw journey
 * (claude.ai artifact 45c3006d, "Lucky Draw Pass — the two-message journey").
 * Trial-reward credentials keep the cream/terracotta Editorial card
 * (qrCardRenderer.js); a draw entry is a different promise and gets its own
 * dark, metallic frame.
 *
 *   variant 'pass'  — WhatsApp/email #1, sent BEFORE the appointment. A
 *                     before→after meter (1× right now → N× after you scan)
 *                     over the QR the consultant scans at the session.
 *   variant 'boost'  — WhatsApp/email #2, sent AFTER the consultant records the
 *                     session. QR-LESS by design: the pass is consumed, so the
 *                     frame is one giant N× and the entrant's standing. A
 *                     scannable-looking receipt would only invite dead scans.
 *
 * The palette is the ONLY thing that changes per campaign — four colorways
 * (titanium/gold/emerald/sapphire) over one layout, picked by
 * `design_config.luckyDraw.passTheme` and clamped to the enum before it ever
 * reaches here.
 *
 * 1080×1080 so the title and the QR/×N both sit inside the middle band that
 * WhatsApp's chat-bubble crop preserves. Pipeline and failure posture are the
 * shared engine's (cardEngine.js): senders treat a throw as "ship without the
 * image", never as a failed delivery.
 */

const SIZE = 1080;
/** The artwork was drawn at 460px with container units; 1cq = 1% of the card. */
const cq = (n) => Math.round(n * (SIZE / 100));

// The QR well is bigger than the artwork's 40cq: a 43-char token puts the pass
// link at QR version 5 (37 modules), and the consultant scans this off a phone
// screen. 408px over 39 units (37 + the SVG's own 1-module margin each side) is
// ~10.5px/module with a ~5-module quiet zone — comfortably inside spec.
const QR_WELL = 496;
const QR_PAD = 44;
const QR_IMG = QR_WELL - QR_PAD * 2;

const MONTH_ABBR = {
  january: 'JAN', february: 'FEB', march: 'MAR', april: 'APR', may: 'MAY', june: 'JUN',
  july: 'JUL', august: 'AUG', september: 'SEP', october: 'OCT', november: 'NOV', december: 'DEC',
};

/** '30 September 2026' → '30 SEP 2026' — the footer line has one line to live in. */
function compactDate(long) {
  return String(long)
    .split(/\s+/)
    .map((word) => MONTH_ABBR[word.toLowerCase()] || word.toUpperCase())
    .join(' ');
}


/**
 * Colorway tokens, ported 1:1 from the artifact. `metal` is the gradient the
 * hero numeral is clipped to — the thing that makes the number read as struck
 * metal rather than coloured text.
 */
const THEMES = {
  titanium: {
    ground: 'radial-gradient(122% 94% at 50% 2%, #1b1e26 0%, #0b0d11 58%)',
    groundFlat: '#0b0d11',
    metal: 'linear-gradient(168deg, #ffffff 2%, #d6dbe1 28%, #8b9199 54%, #f4f6f9 92%)',
    tx: '#eef0f4', sub: '#d9dce2', muted2: '#9aa0aa', dim: '#7c828c', n1: '#868c96',
    hair: 'rgba(255,255,255,.26)', sealbd: 'rgba(255,255,255,.2)', arrow: 'rgba(255,255,255,.5)',
  },
  gold: {
    ground: 'radial-gradient(122% 94% at 50% 2%, #241f13 0%, #0c0a05 60%)',
    groundFlat: '#0c0a05',
    metal: 'linear-gradient(168deg, #fff7e4 2%, #f2d590 26%, #b6853a 54%, #ffe7ad 92%)',
    tx: '#f4edde', sub: '#e7dabc', muted2: '#c6b285', dim: '#93815d', n1: '#9c8b64',
    hair: 'rgba(255,226,160,.26)', sealbd: 'rgba(255,226,160,.22)', arrow: 'rgba(255,232,180,.55)',
  },
  emerald: {
    ground: 'radial-gradient(122% 94% at 50% 2%, #0f2419 0%, #050f0a 60%)',
    groundFlat: '#050f0a',
    metal: 'linear-gradient(168deg, #f4fff8 2%, #c2ecd2 26%, #5ea07d 54%, #eafff2 92%)',
    tx: '#e7f2ea', sub: '#cfe8d9', muted2: '#9cc4ac', dim: '#6e9481', n1: '#6f9a82',
    hair: 'rgba(180,255,214,.24)', sealbd: 'rgba(180,255,214,.2)', arrow: 'rgba(200,255,224,.5)',
  },
  sapphire: {
    ground: 'radial-gradient(122% 94% at 50% 2%, #121c30 0%, #060a15 60%)',
    groundFlat: '#060a15',
    metal: 'linear-gradient(168deg, #f4f8ff 2%, #c6d6f2 26%, #6f89bb 54%, #eaf1ff 92%)',
    tx: '#e8eef9', sub: '#ccd7ec', muted2: '#a2b0cc', dim: '#77839e', n1: '#7686a6',
    hair: 'rgba(190,214,255,.26)', sealbd: 'rgba(190,214,255,.2)', arrow: 'rgba(210,226,255,.55)',
  },
};

/**
 * Approximate advance width (in em) of the hero numeral in Albert Sans 800.
 * The artifact was drawn around "9×"; "10×" is half again as wide and "100×"
 * twice, so a fixed font-size would overrun the card the moment a campaign
 * runs a multiplier the mockup never showed. Digits ≈ .60em, '×' ≈ .86em.
 */
function heroEmWidth(text) {
  return [...text].reduce((w, ch) => w + (ch === '×' ? 0.86 : 0.6), 0);
}

/** Largest size at or below `base` that keeps `text` inside `maxPx`. */
function fitHero(text, maxPx, base) {
  return Math.max(48, Math.min(base, Math.floor(maxPx / heroEmWidth(text))));
}

/** Arrow head as vector — satori renders border-trick triangles unreliably. */
function arrowHeadSrc(color, w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<path d="M0 0 L${w} ${h / 2} L0 ${h} Z" fill="${color}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Card chrome shared by both variants: wordmark left, state seal right, hairline under. */
function chrome(t, mark, seal) {
  return [
    el({ justifyContent: 'space-between', alignItems: 'center' }, [
      txt({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: cq(5.8), lineHeight: 1.1, color: t.tx }, mark),
      txt(
        {
          fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: cq(2.45), letterSpacing: 4.7,
          color: t.muted2, border: `2px solid ${t.sealbd}`, borderRadius: 999,
          padding: `${cq(1.4)}px ${cq(2.8)}px`,
        },
        seal,
      ),
    ]),
    el({ height: 2, marginTop: cq(2.6), backgroundImage: `linear-gradient(90deg, transparent, ${t.hair}, transparent)` }, []),
  ];
}

/**
 * "chances to win <prize>" — the promise line. Serif italic lead-in with the
 * prize itself set upright and semibold, wrapping as one paragraph.
 */
function promiseLine(t, prize, size) {
  return el({ marginTop: cq(1.6), flexWrap: 'wrap', alignItems: 'baseline' }, [
    txt({ fontFamily: 'Fraunces', fontStyle: 'italic', fontWeight: 400, fontSize: size, lineHeight: 1.16, color: t.sub, marginRight: Math.round(size * 0.26) }, 'chances to win'),
    txt({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: size, lineHeight: 1.16, color: t.tx }, prize),
  ]);
}

/** Message 1 — the meter and the QR the consultant scans. */
function passBody(t, { multText, prize, first, qrSrc, deadline }) {
  const copyWidth = SIZE - cq(3.8) * 2 - QR_WELL - 40;
  // The right-hand numeral gets whatever the "1×" block and the arrow leave.
  const heroSize = fitHero(multText, 600, cq(32));

  return [
    el({ marginTop: cq(2.4), alignItems: 'flex-end' }, [
      el({ flexDirection: 'column', alignItems: 'flex-start', flexShrink: 0 }, [
        txt({ fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: cq(2.35), letterSpacing: 3.8, color: t.dim }, 'RIGHT NOW'),
        txt({ fontWeight: 800, fontSize: cq(16), lineHeight: 0.7, letterSpacing: -3, color: t.n1, marginTop: cq(2), paddingBottom: cq(2) }, '1×'),
      ]),
      el({ flexGrow: 1, alignItems: 'center', marginBottom: cq(6.5), padding: `0 ${cq(3)}px` }, [
        el({ flexGrow: 1, height: 2, backgroundImage: `linear-gradient(90deg, transparent, ${t.arrow})` }, []),
        { type: 'img', props: { src: arrowHeadSrc(t.arrow, cq(2.7), cq(3)), width: cq(2.7), height: cq(3) } },
      ]),
      el({ flexDirection: 'column', alignItems: 'flex-start', flexShrink: 0 }, [
        txt({ fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: cq(2.35), letterSpacing: 3.8, color: t.dim }, 'AFTER YOU SCAN'),
        txt(
          {
            fontWeight: 800, fontSize: heroSize, lineHeight: 0.7, letterSpacing: Math.round(heroSize * -0.035),
            marginTop: cq(2), paddingBottom: cq(2),
            backgroundImage: t.metal, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent',
          },
          multText,
        ),
      ]),
    ]),
    promiseLine(t, prize, cq(5)),
    el({ marginTop: 'auto', paddingTop: cq(1.6), alignItems: 'center' }, [
      el(
        {
          width: QR_WELL, height: QR_WELL, flexShrink: 0, padding: QR_PAD,
          backgroundColor: '#FFFFFF', borderRadius: cq(2.6),
          alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 0 2px rgba(255,255,255,.14), 0 22px 43px rgba(0,0,0,.5)',
        },
        [{
          type: 'img',
          props: { src: qrSrc, width: QR_IMG, height: QR_IMG, style: { width: QR_IMG, height: QR_IMG } },
        }],
      ),
      el({ flexDirection: 'column', width: copyWidth, marginLeft: 40 }, [
        txt({ fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: cq(2.6), letterSpacing: 4.5, color: t.muted2 }, `${first}’S ENTRY`),
        txt({ fontWeight: 600, fontSize: 34, lineHeight: 1.22, letterSpacing: -0.3, color: t.tx, marginTop: cq(1.9) }, 'Scan at your appointment to unlock.'),
        ...(deadline
          ? [txt({ fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: cq(2.55), letterSpacing: 2.8, color: t.dim, marginTop: cq(2.4) }, `SCAN BY ${deadline}`)]
          : []),
      ]),
    ]),
  ];
}

/** Message 2 — the boost is live; nothing left to scan. */
function boostBody(t, { multText, prize, first, drawDate }) {
  const heroSize = fitHero(multText, SIZE - cq(3.8) * 2, cq(57));
  const stats = [
    ['ENTRANT', first],
    ['STATUS', 'Unlocked'],
    ...(drawDate ? [['DRAW DATE', drawDate]] : []),
  ];

  return [
    el({ flexDirection: 'column', alignItems: 'flex-start', marginTop: cq(3.4) }, [
      txt({ fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: cq(2.9), letterSpacing: 5, color: t.dim }, 'YOU’RE NOW IN THE DRAW WITH'),
      txt(
        {
          fontWeight: 800, fontSize: heroSize, lineHeight: 0.72, letterSpacing: Math.round(heroSize * -0.04),
          marginTop: cq(1.6), paddingBottom: cq(3),
          backgroundImage: t.metal, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent',
        },
        multText,
      ),
      promiseLine(t, prize, cq(5.4)),
    ]),
    el({ flexDirection: 'column', marginTop: 'auto' }, [
      txt({ fontFamily: 'Fraunces', fontStyle: 'italic', fontWeight: 400, fontSize: cq(3.5), lineHeight: 1.2, color: t.sub }, 'We’ll message you the moment the draw is held.'),
      el({ marginTop: cq(3.4), paddingTop: cq(3.4), borderTop: `2px solid ${t.hair}` },
        stats.map(([k, v]) => el({ flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0, paddingRight: cq(3) }, [
          txt({ fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: cq(2.2), letterSpacing: 2.9, color: t.dim }, k),
          txt({ fontWeight: 600, fontSize: cq(3.3), color: t.tx, marginTop: cq(1.3) }, v),
        ]))),
    ]),
  ];
}

/**
 * Renders a Vault lucky-draw pass as a 1080×1080 PNG buffer.
 *
 * @param {object} opts
 * @param {'pass'|'boost'} opts.variant
 * @param {string} [opts.qrContent]   the claim link — required for 'pass', ignored for 'boost'
 * @param {number} [opts.multiplier]  ×N total chances after the session (NOT "N more")
 * @param {string} [opts.prize]       luckyDraw.prize summary
 * @param {string} [opts.firstName]
 * @param {string} [opts.deadlineLong]  boost deadline, long form — message 1 only
 * @param {string} [opts.drawDateLong]  draw day, long form — message 2 only; omitted when unknown
 * @param {string} [opts.theme]       one of PASS_THEMES
 * @param {string} [opts.wordmark]    brand wordmark, e.g. 'Redeem.'
 */
export async function renderDrawPassPng({
  variant,
  qrContent,
  multiplier,
  prize,
  firstName,
  deadlineLong,
  drawDateLong,
  theme,
  wordmark = 'Redeem.',
}) {
  if (variant !== 'pass' && variant !== 'boost') throw new Error(`unknown draw pass variant: ${variant}`);
  if (variant === 'pass' && !qrContent) throw new Error('qrContent required for the draw entry pass');
  const { satori, Resvg, fonts } = await loadEngine();
  const t = THEMES[resolvePassTheme(theme)];

  // ×N is the TOTAL after the session (1 chance × N), not N extra — every
  // surface in the draw rails says it that way and the two must never drift.
  const mult = Number.isInteger(multiplier) && multiplier >= 2 ? multiplier : 10;
  const multText = `${mult}×`;
  // The prize summary can be a multi-row string ("iPhone 17 Pro + 3× $100
  // voucher"); the card carries the headline, the T&Cs carry the full list.
  const prizeText = clean(prize, 58, 'the prize');
  const first = clean(firstName, 14, 'You').toUpperCase();

  let qrSrc = null;
  if (variant === 'pass') {
    // margin:1 puts one module of quiet zone inside the SVG; the white well's
    // 50px padding adds ~4 more, clearing the ≥4-module scan requirement even
    // if a longer link pushes the QR to a denser version.
    const qrSvg = await QRCode.toString(qrContent, {
      type: 'svg',
      margin: 1,
      color: { dark: '#111318', light: '#FFFFFF' },
    });
    // qrcode emits a viewBox-only root; satori needs explicit intrinsic dimensions.
    const sized = qrSvg.replace('<svg ', `<svg width="${QR_IMG}" height="${QR_IMG}" `);
    qrSrc = `data:image/svg+xml;base64,${Buffer.from(sized).toString('base64')}`;
  }

  const mark = clean(wordmark, 16, 'Redeem.');
  const markBase = mark.endsWith('.') ? mark.slice(0, -1) : mark;

  const card = el(
    {
      width: SIZE, height: SIZE, flexDirection: 'column',
      padding: cq(3.8),
      backgroundColor: t.groundFlat,
      backgroundImage: t.ground,
      fontFamily: 'Albert Sans',
      overflow: 'hidden',
    },
    [
      ...chrome(t, markBase, variant === 'pass' ? 'LUCKY DRAW PASS' : 'BOOST UNLOCKED'),
      ...(variant === 'pass'
        ? passBody(t, { multText, prize: prizeText, first, qrSrc, deadline: deadlineLong ? compactDate(deadlineLong) : null })
        : boostBody(t, { multText, prize: prizeText, first: clean(firstName, 18, 'You'), drawDate: drawDateLong || null })),
    ],
  );

  return renderSquarePng(card, SIZE, { satori, Resvg, fonts });
}

export default { renderDrawPassPng };

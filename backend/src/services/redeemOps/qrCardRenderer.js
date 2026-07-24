import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

/**
 * Editorial voucher-card compositor — wraps the reward QR in the branded
 * "Editorial" frame (claude.ai/design "QR Card Frames" family 1c) so the PNG
 * that lands in WhatsApp / email reads as a voucher, not a bare code.
 *
 * Three states of one card: 'pass' (cream, gold "Reserved.") before unlock,
 * 'voucher' (full terracotta, "Unlocked.") after, and 'boost' (terracotta,
 * "Boosted.") for the recorded draw session — the ONLY QR-less state: the
 * pass is consumed, so the white panel carries a giant ×N instead of a code
 * (a scannable-looking image on a receipt would invite pointless scanning).
 * 1080×1080, QR (or the ×N) on a 594px white panel (55% width, quiet zone
 * ≥4 modules) with the title and panel inside the middle band WhatsApp's
 * chat-bubble crop preserves.
 *
 * Pipeline: satori (layout + text→paths with the bundled Tropic fonts, so no
 * system-font dependency) → resvg (SVG→PNG). Engine + fonts load lazily and
 * cache; senders treat any throw here as "fall back to the bare QR", so a
 * broken native dep degrades delivery quality, never delivery.
 */

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');

const PALETTE = {
  pass: {
    bg: '#FBF7EE',
    ink: '#1B1A17',
    accentDot: '#D6552B',
    kicker: '#6B6558',
    display: '#C89B3C',
    hairline: '#E6E0D1',
    partner: '#6B6558',
    title: '#1B1A17',
    qrBorder: '#E6E0D1',
    statusDot: '#C89B3C',
    status: '#1B1A17',
    code: '#1B1A17',
    expiry: '#6B6558',
    finePrint: '#8B8477',
    powered: '#8B8477',
  },
  voucher: {
    bg: '#D6552B',
    ink: '#FBF7EE',
    accentDot: '#F7E7DC',
    kicker: '#F7E7DC',
    display: '#F7E7DC',
    hairline: 'rgba(251,247,238,.38)',
    partner: '#F7E7DC',
    title: '#FBF7EE',
    qrBorder: null,
    statusDot: '#F7E7DC',
    status: '#FBF7EE',
    code: '#FBF7EE',
    expiry: '#F7E7DC',
    finePrint: 'rgba(247,231,220,.85)',
    powered: 'rgba(247,231,220,.8)',
  },
};
// The boost receipt celebrates like the voucher does — same terracotta frame.
PALETTE.boost = PALETTE.voucher;

let enginePromise = null;
async function loadEngine() {
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

const el = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });
const txt = (style, text) => ({ type: 'div', props: { style, children: text } });

/** Meta/WhatsApp-safe single-line text: collapse whitespace, cap length. */
function clean(value, max, fallback = '') {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || fallback;
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Renders the Editorial QR card as a 1080×1080 PNG buffer.
 *
 * @param {object} opts
 * @param {'pass'|'voucher'|'boost'} opts.state
 * @param {string} [opts.qrContent]  encoded verbatim (claim link for the pass, raw token for the voucher); unused and optional for 'boost'
 * @param {string} [opts.rewardName]
 * @param {string} [opts.partnerName]
 * @param {string} [opts.customerFirstName]
 * @param {string} [opts.shortCode]  voucher manual-fallback code (tokenHint)
 * @param {Date|string|null} [opts.expiresAt]
 * @param {string} [opts.wordmark]   brand wordmark incl. trailing period, e.g. 'Redeem.'
 */
export async function renderQrCardPng({
  state,
  qrContent,
  rewardName,
  partnerName,
  customerFirstName,
  shortCode,
  expiresAt,
  wordmark = 'Redeem.',
  // PR-4 (D5): lucky-draw voice — {multiplier, boostDeadlineLong}. The frame
  // strings swap to the D5 line-set ("LUCKY DRAW PASS" / "You're in." / plain
  // "Nx your chances…"); everything trial-shaped stays byte-identical when
  // absent.
  draw = null,
}) {
  if (state !== 'pass' && state !== 'voucher' && state !== 'boost') {
    throw new Error(`unknown card state: ${state}`);
  }
  const isBoost = state === 'boost';
  if (!qrContent && !isBoost) throw new Error('qrContent required');
  const { satori, Resvg, fonts } = await loadEngine();
  const c = PALETTE[state];

  // QR as crisp vector modules; the 594px white panel supplies a ~72px quiet
  // zone (>4 modules), so the QR itself renders margin-free at 450px. The
  // boost receipt is QR-less by design — nothing left to scan.
  let qrSrc = null;
  if (!isBoost) {
    const qrSvg = await QRCode.toString(qrContent, {
      type: 'svg',
      margin: 0,
      color: { dark: '#1B1A17', light: '#FFFFFF' },
    });
    // qrcode emits a viewBox-only root; satori needs explicit intrinsic dimensions.
    const qrSized = qrSvg.replace('<svg ', '<svg width="450" height="450" ');
    qrSrc = `data:image/svg+xml;base64,${Buffer.from(qrSized).toString('base64')}`;
  }

  const title = clean(rewardName, 70, 'Your reward');
  const partner = clean(partnerName, 48).toUpperCase();
  const first = clean(customerFirstName, 24, 'you');
  const code = clean(shortCode, 24).toUpperCase();
  const expiry = formatExpiry(expiresAt);
  const mark = clean(wordmark, 16, 'Redeem.');
  const markBase = mark.endsWith('.') ? mark.slice(0, -1) : mark;

  const isPass = state === 'pass';
  const isDraw = !!draw;
  const drawMult = isDraw && Number.isInteger(draw.multiplier) ? draw.multiplier : 10;
  const kicker = isBoost ? 'SESSION RECORDED' : isDraw ? 'LUCKY DRAW PASS' : isPass ? 'RESERVATION PASS' : 'VOUCHER · UNLOCKED';
  const displayWord = isBoost ? 'Boosted.' : isDraw ? "You're in." : isPass ? 'Reserved.' : 'Unlocked.';
  const statusLine = isBoost
    ? `Recorded for ${first} — review completed`
    : isDraw
      ? `Held for ${first} — 1 chance in the draw now`
      : isPass
        ? `Held for ${first} — unlock at your appointment`
        : 'Unlocked — present once to redeem';
  const codeLine = isBoost
    ? `WAS 1 CHANCE · NOW ${drawMult}`
    : isDraw
      ? `${drawMult}X YOUR CHANCES WHEN YOU MEET A CONSULTANT`
      : isPass
        ? 'CODE · REVEALED ON UNLOCK'
        : (code ? `CODE ${code}` : 'ONE-TIME VOUCHER');
  // One-date-per-surface (#252): the draw card carries the USER-relevant
  // deadline (complete the review by boostClosesAt); the internal reservation
  // expiry never prints on it. The boost receipt carries NO date at all —
  // the review is done, and boostClosesAt is not a promise about draw day.
  const expiryLine = isBoost
    ? null
    : isDraw
      ? (draw.boostDeadlineLong ? `COMPLETE YOUR REVIEW BY ${String(draw.boostDeadlineLong).toUpperCase()}` : null)
      : expiry ? (isPass ? `EXPIRES ${expiry}` : `VALID TILL ${expiry}`).toUpperCase() : null;

  const card = el(
    {
      width: 1080,
      height: 1080,
      flexDirection: 'column',
      backgroundColor: c.bg,
      fontFamily: 'Albert Sans',
      overflow: 'hidden',
    },
    [
      // Header — wordmark left, state kicker right
      el({ margin: '40px 48px 0', justifyContent: 'space-between', alignItems: 'center' }, [
        el({ alignItems: 'flex-end' }, [
          txt({ fontWeight: 800, fontSize: 34, letterSpacing: -0.3, color: c.ink }, markBase),
          txt({ fontWeight: 800, fontSize: 34, color: c.accentDot }, '.'),
        ]),
        txt({ fontWeight: 600, fontSize: 24, letterSpacing: 4.8, color: c.kicker }, kicker),
      ]),
      // Italic display word — the state, readable at a glance
      el({ marginTop: 8, justifyContent: 'center' }, [
        txt({ fontFamily: 'Fraunces', fontStyle: 'italic', fontWeight: 600, fontSize: 64, lineHeight: 1, color: c.display }, displayWord),
      ]),
      // Hairline-flanked partner line
      el({ marginTop: 14, alignItems: 'center', padding: '0 120px' }, [
        el({ flexGrow: 1, height: 2, backgroundColor: c.hairline }, []),
        txt({ fontWeight: 600, fontSize: 24, letterSpacing: 3.8, color: c.partner, margin: '0 20px' }, partner || 'REDEEM.SG REWARDS'),
        el({ flexGrow: 1, height: 2, backgroundColor: c.hairline }, []),
      ]),
      // Reward title
      el({ marginTop: 8, justifyContent: 'center', padding: '0 80px' }, [
        txt({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: 42, lineHeight: 1.05, color: c.title, textAlign: 'center' }, title),
      ]),
      // QR panel — sacred white, decoration stays outside
      el(
        {
          width: 594,
          height: 594,
          marginTop: 8,
          alignSelf: 'center',
          flexShrink: 0,
          backgroundColor: '#FFFFFF',
          ...(c.qrBorder ? { border: `2px solid ${c.qrBorder}` } : {}),
          alignItems: 'center',
          justifyContent: 'center',
        },
        isBoost
          ? [el({ flexDirection: 'column', alignItems: 'center' }, [
              txt({ fontFamily: 'Fraunces', fontStyle: 'italic', fontWeight: 600, fontSize: 290, lineHeight: 1, color: '#1B1A17' }, `${drawMult}×`),
              txt({ fontWeight: 600, fontSize: 30, letterSpacing: 6, color: '#6B6558', marginTop: 10 }, 'CHANCES IN THE DRAW'),
            ])]
          : [{ type: 'img', props: { src: qrSrc, width: 450, height: 450, style: { width: 450, height: 450 } } }],
      ),
      // Status line
      el({ marginTop: 10, justifyContent: 'center', alignItems: 'center' }, [
        el({ width: 13, height: 13, borderRadius: 7, backgroundColor: c.statusDot, flexShrink: 0, marginRight: 12 }, []),
        txt({ fontFamily: 'Fraunces', fontStyle: 'italic', fontWeight: 400, fontSize: 30, color: c.status }, statusLine),
      ]),
      // Footer stack
      el({ marginTop: 'auto', flexDirection: 'column', alignItems: 'center', paddingBottom: 28 }, [
        txt({ fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: 28, color: c.code, marginBottom: 5 }, codeLine),
        ...(expiryLine
          ? [txt({ fontWeight: 600, fontSize: 24, letterSpacing: 3.4, color: c.expiry, marginBottom: 5 }, expiryLine)]
          : []),
        txt({ fontSize: 24, color: c.finePrint, marginBottom: 5 }, isBoost ? 'Winners are contacted after the draw closes.' : 'Present once. Non-transferable.'),
        txt({ fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: 24, letterSpacing: 2.9, color: c.powered }, 'POWERED BY MKTR'),
      ]),
    ],
  );

  const svg = await satori(card, { width: 1080, height: 1080, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
  return Buffer.from(png);
}

export default { renderQrCardPng };

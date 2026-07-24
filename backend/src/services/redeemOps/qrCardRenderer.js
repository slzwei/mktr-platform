import QRCode from 'qrcode';
import { loadEngine, el, txt, clean, renderSquarePng } from './cardEngine.js';
import { renderDrawPassPng } from './drawPassRenderer.js';
import { longDate } from '../../utils/sgtTime.js';

/**
 * Editorial voucher-card compositor — wraps the reward QR in the branded
 * "Editorial" frame (claude.ai/design "QR Card Frames" family 1c) so the PNG
 * that lands in WhatsApp / email reads as a voucher, not a bare code.
 *
 * Two states of one card: 'pass' (cream, gold "Reserved.") before unlock and
 * 'voucher' (full terracotta, "Unlocked.") after. 1080×1080, QR on a 594px
 * white panel (55% width, quiet zone ≥4 modules) with the title and QR inside
 * the middle band WhatsApp's chat-bubble crop preserves.
 *
 * THIS FRAME IS FOR TRIAL REWARDS. A lucky-draw entitlement is a different
 * promise — no partner, no voucher, a multiplier instead of a code — so when a
 * `draw` context is present every state routes to the dark "Vault" frame in
 * drawPassRenderer.js instead. Callers keep ONE entry point; the branch lives
 * here so no sender has to know which artwork it is asking for.
 *
 * Pipeline: satori (layout + text→paths with the bundled Tropic fonts, so no
 * system-font dependency) → resvg (SVG→PNG). Engine + fonts load lazily and
 * cache (cardEngine.js); senders treat any throw here as "fall back to the
 * bare QR", so a broken native dep degrades delivery quality, never delivery.
 */

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

function formatExpiry(expiresAt) {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Renders the consumer credential card as a 1080×1080 PNG buffer — the
 * Editorial frame for trial rewards, the Vault frame when `draw` is present.
 *
 * @param {object} opts
 * @param {'pass'|'voucher'|'boost'} opts.state  'boost' is draw-only (the receipt at a recorded session)
 * @param {string} [opts.qrContent]  encoded verbatim (claim link for the pass, raw token for the voucher); unused and optional for 'boost'
 * @param {string} [opts.rewardName]
 * @param {string} [opts.partnerName]
 * @param {string} [opts.customerFirstName]
 * @param {string} [opts.shortCode]  voucher manual-fallback code (tokenHint)
 * @param {Date|string|null} [opts.expiresAt]
 * @param {string} [opts.wordmark]   brand wordmark incl. trailing period, e.g. 'Redeem.'
 * @param {null|{multiplier, prize, boostClosesAt, drawOn, passTheme}} [opts.draw]
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
  // Lucky-draw context. Presence routes the whole render to the Vault frame
  // (drawPassRenderer.js); everything trial-shaped stays byte-identical when
  // absent.
  draw = null,
}) {
  if (state !== 'pass' && state !== 'voucher' && state !== 'boost') {
    throw new Error(`unknown card state: ${state}`);
  }

  if (draw) {
    // 'voucher' cannot happen on a draw rail (a boost mints no redeemable
    // token) — if it ever does, the entry pass is the honest artwork.
    return renderDrawPassPng({
      variant: state === 'boost' ? 'boost' : 'pass',
      qrContent,
      multiplier: draw.multiplier,
      prize: draw.prize,
      firstName: customerFirstName,
      // Accept either the raw YMD or a pre-formatted long date, so callers that
      // already formatted for their own copy don't have to unformat.
      deadlineLong: draw.boostDeadlineLong || longDate(draw.boostClosesAt) || null,
      drawDateLong: draw.drawDateLong || longDate(draw.drawOn) || null,
      theme: draw.passTheme,
      wordmark,
    });
  }

  // 'boost' only exists on the draw rails — reaching here means a caller lost
  // its draw context, and a terracotta "Boosted." card would be a lie about a
  // partner voucher. Throw so the sender ships without an image instead.
  if (state === 'boost') throw new Error('boost cards require a draw context');
  if (!qrContent) throw new Error('qrContent required');
  const { satori, Resvg, fonts } = await loadEngine();
  const c = PALETTE[state];

  // QR as crisp vector modules; the 594px white panel supplies a ~72px quiet
  // zone (>4 modules), so the QR itself renders margin-free at 450px.
  const qrSvg = await QRCode.toString(qrContent, {
    type: 'svg',
    margin: 0,
    color: { dark: '#1B1A17', light: '#FFFFFF' },
  });
  // qrcode emits a viewBox-only root; satori needs explicit intrinsic dimensions.
  const qrSized = qrSvg.replace('<svg ', '<svg width="450" height="450" ');
  const qrSrc = `data:image/svg+xml;base64,${Buffer.from(qrSized).toString('base64')}`;

  const title = clean(rewardName, 70, 'Your reward');
  const partner = clean(partnerName, 48).toUpperCase();
  const first = clean(customerFirstName, 24, 'you');
  const code = clean(shortCode, 24).toUpperCase();
  const expiry = formatExpiry(expiresAt);
  const mark = clean(wordmark, 16, 'Redeem.');
  const markBase = mark.endsWith('.') ? mark.slice(0, -1) : mark;

  const isPass = state === 'pass';
  const kicker = isPass ? 'RESERVATION PASS' : 'VOUCHER · UNLOCKED';
  const displayWord = isPass ? 'Reserved.' : 'Unlocked.';
  const statusLine = isPass
    ? `Held for ${first} — unlock at your appointment`
    : 'Unlocked — present once to redeem';
  const codeLine = isPass
    ? 'CODE · REVEALED ON UNLOCK'
    : (code ? `CODE ${code}` : 'ONE-TIME VOUCHER');
  const expiryLine = expiry ? (isPass ? `EXPIRES ${expiry}` : `VALID TILL ${expiry}`).toUpperCase() : null;

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
        [{ type: 'img', props: { src: qrSrc, width: 450, height: 450, style: { width: 450, height: 450 } } }],
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
        txt({ fontSize: 24, color: c.finePrint, marginBottom: 5 }, 'Present once. Non-transferable.'),
        txt({ fontFamily: 'JetBrains Mono', fontWeight: 600, fontSize: 24, letterSpacing: 2.9, color: c.powered }, 'POWERED BY MKTR'),
      ]),
    ],
  );

  return renderSquarePng(card, 1080, { satori, Resvg, fonts });
}

export default { renderQrCardPng };
